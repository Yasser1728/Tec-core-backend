import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class KycService {
  constructor(private readonly prisma: PrismaService) {}

  // ✅ جيب أو أنشئ KYC record
  async getOrCreate(userId: string, data?: {
    piUserId?: string;
    username?: string;
  }) {
    let kyc = await this.prisma.kyc.findUnique({
      where: { user_id: userId },
      include: { audit_logs: { orderBy: { created_at: 'desc' }, take: 5 } },
    });

    if (!kyc) {
      kyc = await this.prisma.kyc.create({
        data: {
          user_id: userId,
          pi_user_id: data?.piUserId,
          username: data?.username,
          status: 'NOT_STARTED',
          level: 'L0',
        },
        include: { audit_logs: true },
      });
      console.log(`[KycService] KYC record created for user: ${userId}`);
    }

    return kyc;
  }

  // ✅ جيب الـ status
  async getStatus(userId: string) {
    const kyc = await this.prisma.kyc.findUnique({
      where: { user_id: userId },
      include: {
        audit_logs: { orderBy: { created_at: 'desc' }, take: 5 },
      },
    });

    if (!kyc) {
      return this.getOrCreate(userId);
    }

    return kyc;
  }

  // ✅ ابدأ الـ KYC
  async startKyc(userId: string) {
    const kyc = await this.getOrCreate(userId);

    if (kyc.status === 'VERIFIED') {
      throw new BadRequestException('KYC already verified');
    }

    if (kyc.status === 'PENDING') {
      throw new BadRequestException('KYC already submitted and under review');
    }

    const updated = await this.prisma.kyc.update({
      where: { user_id: userId },
      data: { status: 'NOT_STARTED' },
    });

    await this.createAuditLog(kyc.id, 'start', kyc.status, 'NOT_STARTED');
    return updated;
  }

  // ✅ Upload documents
  async uploadDocuments(
    userId: string,
    data: {
      idFrontUrl?: string;
      idBackUrl?: string;
      selfieUrl?: string;
    },
  ) {
    const kyc = await this.getOrCreate(userId);

    if (kyc.status === 'VERIFIED') {
      throw new BadRequestException('KYC already verified');
    }

    const updated = await this.prisma.kyc.update({
      where: { user_id: userId },
      data: {
        ...(data.idFrontUrl && { id_front_url: data.idFrontUrl }),
        ...(data.idBackUrl && { id_back_url: data.idBackUrl }),
        ...(data.selfieUrl && { selfie_url: data.selfieUrl }),
      },
    });

    await this.createAuditLog(kyc.id, 'upload_documents', kyc.status, kyc.status, {
      uploaded: Object.keys(data).filter(k => data[k as keyof typeof data]),
    });

    return updated;
  }

  // ✅ Submit KYC
  async submitKyc(userId: string) {
    const kyc = await this.getOrCreate(userId);

    if (kyc.status === 'VERIFIED') {
      throw new BadRequestException('KYC already verified');
    }

    if (kyc.status === 'PENDING') {
      throw new BadRequestException('KYC already submitted');
    }

    if (!kyc.id_front_url || !kyc.selfie_url) {
      throw new BadRequestException(
        'Please upload ID front and selfie before submitting',
      );
    }

    const updated = await this.prisma.kyc.update({
      where: { user_id: userId },
      data: {
        status: 'PENDING',
        submitted_at: new Date(),
      },
    });

    await this.createAuditLog(kyc.id, 'submit', kyc.status, 'PENDING');
    console.log(`[KycService] KYC submitted for user: ${userId}`);
    return updated;
  }

  // ✅ Admin: Verify KYC
  async verifyKyc(userId: string, level: 'L1' | 'L2' = 'L1') {
    const kyc = await this.prisma.kyc.findUnique({
      where: { user_id: userId },
    });

    if (!kyc) throw new NotFoundException('KYC record not found');

    const updated = await this.prisma.kyc.update({
      where: { user_id: userId },
      data: {
        status: 'VERIFIED',
        level,
        verified_at: new Date(),
        rejection_reason: null,
      },
    });

    await this.createAuditLog(kyc.id, 'verify', kyc.status, 'VERIFIED', { level });
    console.log(`[KycService] KYC verified for user: ${userId} level: ${level}`);

    // ✅ Emit kyc.verified event (Redis)
    await this.emitKycVerified(userId, level);

    return updated;
  }

  // ✅ Admin: Reject KYC
  async rejectKyc(userId: string, reason: string) {
    const kyc = await this.prisma.kyc.findUnique({
      where: { user_id: userId },
    });

    if (!kyc) throw new NotFoundException('KYC record not found');

    const updated = await this.prisma.kyc.update({
      where: { user_id: userId },
      data: {
        status: 'REJECTED',
        rejection_reason: reason,
        rejected_at: new Date(),
      },
    });

    await this.createAuditLog(kyc.id, 'reject', kyc.status, 'REJECTED', { reason });
    console.log(`[KycService] KYC rejected for user: ${userId}`);
    return updated;
  }

  // ─── Helpers ─────────────────────────────────────────
  private async createAuditLog(
    kycId: string,
    action: string,
    fromStatus: any,
    toStatus: any,
    metadata?: Record<string, unknown>,
  ) {
    await this.prisma.kycAuditLog.create({
      data: {
        kyc_id: kycId,
        action,
        from_status: fromStatus,
        to_status: toStatus,
        metadata: (metadata ?? {}) as any,
      },
    });
  }

  private async emitKycVerified(userId: string, level: string) {
    try {
      const Redis = require('ioredis');
      const redisUrl = process.env.REDIS_URL;
      if (!redisUrl) return;

      const client = new Redis(redisUrl, {
        maxRetriesPerRequest: 3,
        enableOfflineQueue: true,
      });

      await client.xadd(
        'kyc.verified',
        '*',
        'data', JSON.stringify({
          userId,
          level,
          timestamp: new Date().toISOString(),
        }),
      );

      await client.quit();
      console.log(`[KycService] kyc.verified event emitted for user: ${userId}`);
    } catch (err) {
      console.warn(`[KycService] Failed to emit kyc.verified: ${(err as Error).message}`);
    }
  }
}
