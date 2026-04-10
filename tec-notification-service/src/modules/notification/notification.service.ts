import { Injectable, Logger }  from '@nestjs/common';
import { PrismaService }       from '../../prisma/prisma.service';
import { FcmService }          from './fcm.service';

export interface CreateNotificationDto {
  userId:    string;
  type:      'PAYMENT' | 'WALLET' | 'KYC' | 'SECURITY' | 'SYSTEM';
  title:     string;
  message:   string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fcm:    FcmService,
  ) {}

  async create(dto: CreateNotificationDto) {
    const notification = await this.prisma.notification.create({
      data: {
        user_id:  dto.userId,
        type:     dto.type,
        title:    dto.title,
        message:  dto.message,
        metadata: (dto.metadata ?? {}) as any,
      },
    });

    this.logger.log(`Created: ${dto.type} for user ${dto.userId}`);

    if (this.fcm.isEnabled) {
      this.sendPush(dto).catch(err =>
        this.logger.error(`FCM push failed: ${(err as Error).message}`)
      );
    }

    return notification;
  }

  private async sendPush(dto: CreateNotificationDto): Promise<void> {
    const tokens = await this.prisma.deviceToken.findMany({
      where:  { user_id: dto.userId },
      select: { token: true },
    });

    if (tokens.length === 0) return;

    const tokenList = tokens.map((t: { token: string }) => t.token);

    const { failed } = await this.fcm.sendToTokens(
      tokenList,
      dto.title,
      dto.message,
      { type: dto.type, userId: dto.userId },
    );

    if (failed > 0) {
      this.logger.warn(`${failed} FCM tokens may be expired`);
    }
  }

  async getByUserId(userId: string, limit = 20) {
    return this.prisma.notification.findMany({
      where:   { user_id: userId },
      orderBy: { created_at: 'desc' },
      take:    limit,
    });
  }

  async getUnreadCount(userId: string) {
    return this.prisma.notification.count({
      where: { user_id: userId, read: false },
    });
  }

  async markAsRead(id: string, userId: string) {
    return this.prisma.notification.updateMany({
      where: { id, user_id: userId },
      data:  { read: true },
    });
  }

  async markAllAsRead(userId: string) {
    return this.prisma.notification.updateMany({
      where: { user_id: userId, read: false },
      data:  { read: true },
    });
  }
}
