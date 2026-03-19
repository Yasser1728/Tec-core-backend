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

  private getUserIdAndInfo(authorization: string): {
    userId: string;
    piUserId: string;
    username: string;
  } {
    if (!authorization?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing token');
    }
    const token = authorization.replace('Bearer ', '');
    try {
      const decoded = this.jwtService.verify(token) as any;
      return {
        userId: decoded.sub ?? decoded.id ?? decoded.userId,
        // ✅ pi_uid هو الاسم الصح في الـ JWT
        piUserId: decoded.pi_uid ?? decoded.piId ?? decoded.pi_user_id ?? decoded.sub,
        // ✅ pi_username هو الاسم الصح في الـ JWT
        username: decoded.pi_username ?? decoded.username ?? decoded.piUsername ?? 'unknown',
      };
    } catch {
      throw new UnauthorizedException('Invalid token');
    }
  }

  // GET /identity/me
  @Get('me')
  async getMe(@Headers('authorization') auth: string) {
    const { piUserId, username } = this.getUserIdAndInfo(auth);
    const user = await this.identityService.findOrCreateUser({
      piUserId,
      username,
    });
    return { success: true, data: { user } };
  }

  // GET /identity/profile
  @Get('profile')
  async getProfile(@Headers('authorization') auth: string) {
    const { piUserId, username } = this.getUserIdAndInfo(auth);
    const user = await this.identityService.findOrCreateUser({
      piUserId,
      username,
    });
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
    const { piUserId, username } = this.getUserIdAndInfo(auth);
    const user = await this.identityService.findOrCreateUser({
      piUserId,
      username,
    });
    const profile = await this.identityService.updateProfile(user.id, body);
    return { success: true, data: { profile } };
  }

  // GET /identity/kyc
  @Get('kyc')
  async getKyc(@Headers('authorization') auth: string) {
    const { piUserId, username } = this.getUserIdAndInfo(auth);
    const user = await this.identityService.findOrCreateUser({
      piUserId,
      username,
    });
    const kyc = await this.identityService.getKycStatus(user.id);
    return { success: true, data: { kyc } };
  }

  // GET /identity/roles
  @Get('roles')
  async getRoles(@Headers('authorization') auth: string) {
    const { piUserId, username } = this.getUserIdAndInfo(auth);
    const user = await this.identityService.findOrCreateUser({
      piUserId,
      username,
    });
    const roles = user.roles.map((ur) => ur.role.name);
    return { success: true, data: { roles } };
  }
}
