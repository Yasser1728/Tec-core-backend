import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import pino              from 'pino';
import { PrismaService } from '../../prisma/prisma.service';
import { KycStatus }     from '@prisma/client';

const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base:  { service: 'kyc-service' },
});

@Injectable()
export class KycService {
  constructor(private readonly prisma: PrismaService) {}

  async getOrCreate(userId: string, data?: { piUserId?: string; username?: string }) {
    let kyc = await this.prisma.kyc.findUnique({
      where:   { user_id: userId },
      include: { audit_logs: { orderBy: { created_at: 'desc' }, take: 5 } },
    });

    if (!kyc) {
      kyc = await this.prisma.kyc.create({
        data: {
          user_id:    userId,
          pi_user_id: data?.piUserId,
          username:   data?.username,
          status:     'NOT_STARTED',
          level:      'L0',
        },
        include: { audit_logs: true },
      });
      logger.info({ userId }, '[KycService] KYC record created');
    }

    return kyc;
  }

  async getStatus(userId: string) {
    const kyc = await this.prisma.kyc.findUnique({
      where:   { user_id: userId },
      include: { audit_logs: { orderBy: { created_at: 'desc' }, take: 5 } },
    });
    return kyc ?? this.getOrCreate(userId);
  }

  async startKyc(userId: string) {
    const kyc = await this.getOrCreate(userId);
    if (kyc.status === 'VERIFIED') throw new BadRequestException('KYC already verified');
    if (kyc.status === 'PENDING')  throw new BadRequestException('KYC already submitted and under review');

    const updated = await this.prisma.kyc.update({
      where: { user_id: userId },
      data:  { status: 'NOT_STARTED' },
    });
    await this.createAuditLog(kyc.id, 'start', kyc.status, 'NOT_STARTED');
    return updated;
  }

  async uploadDocuments(
    userId: string,
    data: { idFrontUrl?: string; idBackUrl?: string; selfieUrl?: string },
  ) {
    const kyc = await this.getOrCreate(userId);
    if (kyc.status === 'VERIFIED') throw new BadRequestException('KYC already verified');

    const updated = await this.prisma.kyc.update({
      where: { user_id: userId },
      data: {
        ...(data.idFrontUrl && { id_front_url: data.idFrontUrl }),
        ...(data.idBackUrl  && { id_back_url:  data.idBackUrl  }),
        ...(data.selfieUrl  && { selfie_url:    data.selfieUrl  }),
      },
    });

    await this.createAuditLog(kyc.id, 'upload_documents', kyc.status, kyc.status, {
      uploaded: Object.keys(data).filter(k => data[k as keyof typeof data]),
    });

    return updated;
  }

  async submitKyc(userId: string) {
    const kyc = await this.getOrCreate(userId);
    if (kyc.status === 'VERIFIED') throw new BadRequestException('KYC already verified');
    if (kyc.status === 'PENDING')  throw new BadRequestException('KYC already submitted');
    if (!kyc.id_front_url || !kyc.selfie_url) {
      throw new BadRequestException('Please upload ID front and selfie before submitting');
    }

    const updated = await this.prisma.kyc.update({
      where: { user_id: userId },
      data:  { status: 'PENDING', submitted_at: new Date() },
    });

    await this.createAuditLog(kyc.id, 'submit', kyc.status, 'PENDING');
    logger.info({ userId }, '[KycService] KYC submitted');
    return updated;
  }

  async verifyKyc(userId: string, level: 'L1' | 'L2' = 'L1') {
    const kyc = await this.prisma.kyc.findUnique({ where: { user_id: userId } });
    if (!kyc) throw new NotFoundException('KYC record not found');

    const updated = await this.prisma.kyc.update({
      where: { user_id: userId },
      data:  { status: 'VERIFIED', level, verified_at: new Date(), rejection_reason: null },
    });

    await this.createAuditLog(kyc.id, 'verify', kyc.status, 'VERIFIED', { level });
    logger.info({ userId, level }, '[KycService] KYC verified');
    await this.emitKycVerified(userId, level);
    return updated;
  }

  async rejectKyc(userId: string, reason: string) {
    const kyc = await this.prisma.kyc.findUnique({ where: { user_id: userId } });
    if (!kyc) throw new NotFoundException('KYC record not found');

    const updated = await this.prisma.kyc.update({
      where: { user_id: userId },
      data:  { status: 'REJECTED', rejection_reason: reason, rejected_at: new Date() },
    });

    await this.createAuditLog(kyc.id, 'reject', kyc.status, 'REJECTED', { reason });
    logger.info({ userId }, '[KycService] KYC rejected');
    return updated;
  }

  private async createAuditLog(
    kycId:      string,
    action:     string,
    fromStatus: KycStatus,
    toStatus:   KycStatus,
    metadata?:  Record<string, unknown>,
  ) {
    await this.prisma.kycAuditLog.create({
      data: {
        kyc_id:      kycId,
        action,
        from_status: fromStatus,
        to_status:   toStatus,
        metadata:    (metadata ?? {}) as Record<string, unknown>,
      },
    });
  }

  // ✅ P0-6: shared Redis publisher بدل new Redis() per call
  private async emitKycVerified(userId: string, level: string): Promise<void> {
    try {
      const redisUrl = process.env.REDIS_URL;
      if (!redisUrl) return;

      const { publishEvent } = await import('@yasser172/tec-shared');
      await publishEvent('kyc.verified', {
        userId,
        level,
        timestamp: new Date().toISOString(),
      });

      logger.info({ userId }, '[KycService] kyc.verified event emitted');
    } catch (err: unknown) {
      logger.warn({ err }, '[KycService] Failed to emit kyc.verified');
    }
  }
  }
