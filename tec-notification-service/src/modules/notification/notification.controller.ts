import {
  Controller,
  Get,
  Patch,
  Param,
  Headers,
  UnauthorizedException,
  Query,
} from '@nestjs/common';
import { NotificationService } from './notification.service';
import { JwtService }          from '@nestjs/jwt';

@Controller('notifications')
export class NotificationController {
  constructor(
    private readonly notificationService: NotificationService,
    private readonly jwtService:          JwtService,
  ) {}

  private getUserId(authorization: string): string {
    if (!authorization?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing token');
    }
    const token = authorization.replace('Bearer ', '');
    try {
      // ✅ verify() بدل decode() — يتحقق من التوقيع والصلاحية
      const payload = this.jwtService.verify<{ sub?: string; id?: string; userId?: string }>(token);
      const userId  = payload.sub ?? payload.id ?? payload.userId;
      if (!userId) throw new Error('Missing user ID in token');
      return userId;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  @Get()
  async getNotifications(
    @Headers('authorization') auth: string,
    @Query('limit') limit?: string,
  ) {
    const userId      = this.getUserId(auth);
    const notifications = await this.notificationService.getByUserId(
      userId,
      limit ? parseInt(limit) : 20,
    );
    const unreadCount = await this.notificationService.getUnreadCount(userId);
    return { success: true, data: { notifications, unreadCount } };
  }

  @Patch(':id/read')
  async markAsRead(
    @Headers('authorization') auth: string,
    @Param('id') id: string,
  ) {
    const userId = this.getUserId(auth);
    await this.notificationService.markAsRead(id, userId);
    return { success: true };
  }

  @Patch('read-all')
  async markAllAsRead(@Headers('authorization') auth: string) {
    const userId = this.getUserId(auth);
    await this.notificationService.markAllAsRead(userId);
    return { success: true };
  }
}
