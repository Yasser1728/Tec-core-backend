import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface CreateNotificationDto {
  userId: string;
  type: 'PAYMENT' | 'WALLET' | 'KYC' | 'SECURITY' | 'SYSTEM';
  title: string;
  message: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class NotificationService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateNotificationDto) {
    const notification = await this.prisma.notification.create({
      data: {
        user_id: dto.userId,
        type: dto.type,
        title: dto.title,
        message: dto.message,
        metadata: (dto.metadata ?? {}) as any, // ✅ fix
      },
    });
    console.log(`[NotificationService] Created: ${dto.type} for user ${dto.userId}`);
    return notification;
  }

  async getByUserId(userId: string, limit = 20) {
    return this.prisma.notification.findMany({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
      take: limit,
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
      data: { read: true },
    });
  }

  async markAllAsRead(userId: string) {
    return this.prisma.notification.updateMany({
      where: { user_id: userId, read: false },
      data: { read: true },
    });
  }
}
