import {
  Controller, Post, Delete, Body,
  Headers, UnauthorizedException, HttpCode, HttpStatus,
} from '@nestjs/common';
import { JwtService }          from '@nestjs/jwt';
import { PrismaService }       from '../../prisma/prisma.service';

@Controller('notifications/device-tokens')
export class DeviceTokenController {
  constructor(
    private readonly prisma:      PrismaService,
    private readonly jwtService:  JwtService,
  ) {}

  private getUserId(authorization: string): string {
    if (!authorization?.startsWith('Bearer '))
      throw new UnauthorizedException('Missing token');
    try {
      const decoded = this.jwtService.decode(
        authorization.replace('Bearer ', '')
      ) as any;
      return decoded?.sub ?? decoded?.id;
    } catch {
      throw new UnauthorizedException('Invalid token');
    }
  }

  // ── Register FCM token ────────────────────────────────
  @Post()
  @HttpCode(HttpStatus.OK)
  async register(
    @Headers('authorization') auth: string,
    @Body() body: { token: string; platform?: string },
  ) {
    const userId = this.getUserId(auth);
    if (!body.token) throw new UnauthorizedException('token required');

    await this.prisma.deviceToken.upsert({
      where:  { token: body.token },
      update: { user_id: userId, platform: body.platform ?? 'web' },
      create: { user_id: userId, token: body.token, platform: body.platform ?? 'web' },
    });

    return { success: true, message: 'Device token registered' };
  }

  // ── Remove FCM token (logout) ─────────────────────────
  @Delete()
  @HttpCode(HttpStatus.OK)
  async remove(
    @Headers('authorization') auth: string,
    @Body() body: { token: string },
  ) {
    const userId = this.getUserId(auth);
    await this.prisma.deviceToken.deleteMany({
      where: { token: body.token, user_id: userId },
    });
    return { success: true, message: 'Device token removed' };
  }
}
