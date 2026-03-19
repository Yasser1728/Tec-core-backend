import {
  Controller,
  Get,
  Patch,
  Body,
  Headers,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { IdentityService } from './identity.service';

@Controller('identity')
export class IdentityController {
  constructor(
    private readonly identityService: IdentityService,
    private readonly jwtService: JwtService,
  ) {}

  // ✅ استخرج الـ userId من الـ JWT
  private getUserId(authorization: string): string {
    if (!authorization?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing token');
    }
    const token = authorization.replace('Bearer ', '');
    try {
      const decoded = this.jwtService.verify(token) as any;
      return decoded.sub ?? decoded.id ?? decoded.userId;
    } catch {
      throw new UnauthorizedException('Invalid token');
    }
  }

  // GET /identity/me
  @Get('me')
  async getMe(@Headers('authorization') auth: string) {
    const userId = this.getUserId(auth);
    const user = await this.identityService.getProfile(userId);
    return { success: true, data: { user } };
  }

  // GET /identity/profile
  @Get('profile')
  async getProfile(@Headers('authorization') auth: string) {
    const userId = this.getUserId(auth);
    const user = await this.identityService.getProfile(userId);
    return { success: true, data: { profile: user.profile } };
  }

  // PATCH /identity/profile
  @Patch('profile')
  async updateProfile(
    @Headers('authorization') auth: string,
    @Body() body: {
      displayName?: string;
      bio?: string;
      country?: string;
      language?: string;
      avatarUrl?: string;
    },
  ) {
    const userId = this.getUserId(auth);
    const profile = await this.identityService.updateProfile(userId, body);
    return { success: true, data: { profile } };
  }

  // GET /identity/kyc
  @Get('kyc')
  async getKyc(@Headers('authorization') auth: string) {
    const userId = this.getUserId(auth);
    const kyc = await this.identityService.getKycStatus(userId);
    return { success: true, data: { kyc } };
  }

  // GET /identity/roles
  @Get('roles')
  async getRoles(@Headers('authorization') auth: string) {
    const userId = this.getUserId(auth);
    const user = await this.identityService.getProfile(userId);
    const roles = user.roles.map((ur) => ur.role.name);
    return { success: true, data: { roles } };
  }
}
