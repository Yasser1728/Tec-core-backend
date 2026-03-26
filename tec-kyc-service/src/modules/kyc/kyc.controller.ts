import {
  Controller,
  Get,
  Post,
  Body,
  Headers,
  UnauthorizedException,
  Param,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { KycService } from './kyc.service';

@Controller('kyc')
export class KycController {
  constructor(
    private readonly kycService: KycService,
    private readonly jwtService: JwtService,
  ) {}

  private getUserInfo(authorization: string): {
    userId: string;
    piUserId: string;
    username: string;
  } {
    if (!authorization?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing token');
    }
    const token = authorization.replace('Bearer ', '');
    try {
      const decoded = this.jwtService.decode(token) as any; // ← verify → decode
      if (!decoded) throw new Error('Invalid token');
      return {
        userId:   decoded.sub ?? decoded.id,
        piUserId: decoded.pi_uid ?? decoded.sub,
        username: decoded.pi_username ?? 'unknown',
      };
    } catch {
      throw new UnauthorizedException('Invalid token');
    }
  }

  @Get('status')
  async getStatus(@Headers('authorization') auth: string) {
    const { userId, piUserId, username } = this.getUserInfo(auth);
    const kyc = await this.kycService.getOrCreate(userId, { piUserId, username });
    return { success: true, data: { kyc } };
  }

  @Post('start')
  async startKyc(@Headers('authorization') auth: string) {
    const { userId } = this.getUserInfo(auth);
    const kyc = await this.kycService.startKyc(userId);
    return { success: true, data: { kyc } };
  }

  @Post('upload')
  async uploadDocuments(
    @Headers('authorization') auth: string,
    @Body() body: { idFrontUrl?: string; idBackUrl?: string; selfieUrl?: string },
  ) {
    const { userId } = this.getUserInfo(auth);
    const kyc = await this.kycService.uploadDocuments(userId, body);
    return { success: true, data: { kyc } };
  }

  @Post('submit')
  async submitKyc(@Headers('authorization') auth: string) {
    const { userId } = this.getUserInfo(auth);
    const kyc = await this.kycService.submitKyc(userId);
    return { success: true, data: { kyc } };
  }

  @Post('admin/verify/:userId')
  async verifyKyc(
    @Param('userId') userId: string,
    @Body() body: { level?: 'L1' | 'L2' },
  ) {
    const kyc = await this.kycService.verifyKyc(userId, body.level ?? 'L1');
    return { success: true, data: { kyc } };
  }

  @Post('admin/reject/:userId')
  async rejectKyc(
    @Param('userId') userId: string,
    @Body() body: { reason: string },
  ) {
    const kyc = await this.kycService.rejectKyc(userId, body.reason);
    return { success: true, data: { kyc } };
  }
}
