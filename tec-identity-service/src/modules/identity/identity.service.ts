import { Injectable, NotFoundException } from '@nestjs/common';
import { Logger }                         from '@nestjs/common';
import { PrismaService }                  from '../../prisma/prisma.service';

@Injectable()
export class IdentityService {
  private readonly logger = new Logger(IdentityService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findOrCreateUser(data: { piUserId: string; username: string }) {
    let user = await this.prisma.user.findUnique({
      where:   { pi_user_id: data.piUserId },
      include: { profile: true, kyc: true, roles: { include: { role: true } } },
    });

    if (!user) {
      user = await this.prisma.user.create({
        data: {
          pi_user_id: data.piUserId,
          username:   data.username,
          profile: {
            create: {
              display_name: data.username,
              language:     'en',
            },
          },
          kyc: {
            create: {
              status: 'PENDING',
              level:  'L1',
            },
          },
          roles: {
            create: {
              role: {
                connectOrCreate: {
                  where:  { name: 'USER' },
                  create: { name: 'USER' },
                },
              },
            },
          },
        },
        include: {
          profile: true,
          kyc:     true,
          roles:   { include: { role: true } },
        },
      });

      this.logger.log(`New user created: ${data.username}`);
    }

    return user;
  }

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where:   { id: userId },
      include: { profile: true, kyc: true, roles: { include: { role: true } } },
    });

    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async updateProfile(
    userId: string,
    data: {
      displayName?: string;
      bio?:         string;
      country?:     string;
      language?:    string;
      avatarUrl?:   string;
    },
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    return this.prisma.profile.upsert({
      where:  { user_id: userId },
      create: {
        user_id:      userId,
        display_name: data.displayName,
        bio:          data.bio,
        country:      data.country,
        language:     data.language ?? 'en',
        avatar_url:   data.avatarUrl,
      },
      update: {
        ...(data.displayName && { display_name: data.displayName }),
        ...(data.bio         && { bio:          data.bio         }),
        ...(data.country     && { country:      data.country     }),
        ...(data.language    && { language:     data.language    }),
        ...(data.avatarUrl   && { avatar_url:   data.avatarUrl   }),
      },
    });
  }

  async getKycStatus(userId: string) {
    const kyc = await this.prisma.kyc.findUnique({ where: { user_id: userId } });
    if (!kyc) throw new NotFoundException('KYC record not found');
    return kyc;
  }
}
