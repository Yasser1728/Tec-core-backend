import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SubscriptionPlan, SubscriptionStatus } from '../../../prisma/client';

export const PLANS: Record<SubscriptionPlan, {
  name:        string;
  price:       number;
  currency:    string;
  duration:    number; // days
  features:    string[];
}> = {
  FREE: {
    name:     'Free',
    price:    0,
    currency: 'PI',
    duration: 0, // no expiry
    features: [
      'Up to 5 assets',
      'Basic wallet',
      'Community access',
    ],
  },
  PRO: {
    name:     'Pro',
    price:    10,
    currency: 'PI',
    duration: 30,
    features: [
      'Unlimited assets',
      'Advanced wallet',
      'Priority support',
      'Analytics dashboard',
      'Commerce store',
    ],
  },
  ENTERPRISE: {
    name:     'Enterprise',
    price:    50,
    currency: 'PI',
    duration: 30,
    features: [
      'Everything in Pro',
      'Custom domain',
      'API access',
      'Dedicated support',
      'White-label options',
      'Advanced analytics',
    ],
  },
};

@Injectable()
export class SubscriptionService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Get Plans ───────────────────────────────────────────────
  getPlans() {
    return Object.entries(PLANS).map(([key, plan]) => ({
      id:       key as SubscriptionPlan,
      ...plan,
    }));
  }

  // ── Get User Subscription ───────────────────────────────────
  async getSubscription(userId: string) {
    let sub = await this.prisma.subscription.findUnique({
      where:   { user_id: userId },
      include: { history: { orderBy: { created_at: 'desc' }, take: 5 } },
    });

    // Auto-create FREE subscription if none exists
    if (!sub) {
      sub = await this.prisma.subscription.create({
        data: {
          user_id: userId,
          plan:    'FREE',
          status:  'ACTIVE',
          history: {
            create: { plan: 'FREE', status: 'ACTIVE', note: 'Default free plan' },
          },
        },
        include: { history: { orderBy: { created_at: 'desc' }, take: 5 } },
      });
    }

    return {
      ...sub,
      planDetails: PLANS[sub.plan],
      isActive:    sub.status === 'ACTIVE',
      isExpired:   sub.current_period_end
        ? new Date() > new Date(sub.current_period_end)
        : false,
    };
  }

  // ── Subscribe ────────────────────────────────────────────────
  async subscribe(data: {
    userId:       string;
    plan:         SubscriptionPlan;
    paymentId?:   string;
    piPaymentId?: string;
  }) {
    if (data.plan === 'FREE') {
      throw new BadRequestException('Cannot subscribe to free plan');
    }

    const planDetails = PLANS[data.plan];
    if (!planDetails) throw new BadRequestException('Invalid plan');

    const existing = await this.prisma.subscription.findUnique({
      where: { user_id: data.userId },
    });

    if (existing?.plan === data.plan && existing?.status === 'ACTIVE') {
      throw new ConflictException(`Already subscribed to ${data.plan}`);
    }

    const now   = new Date();
    const end   = new Date(now);
    end.setDate(end.getDate() + planDetails.duration);

    const sub = await this.prisma.subscription.upsert({
      where: { user_id: data.userId },
      create: {
        user_id:              data.userId,
        plan:                 data.plan,
        status:               'ACTIVE',
        payment_id:           data.paymentId,
        pi_payment_id:        data.piPaymentId,
        current_period_start: now,
        current_period_end:   end,
        history: {
          create: {
            plan:       data.plan,
            status:     'ACTIVE',
            payment_id: data.paymentId,
            note:       `Subscribed to ${data.plan}`,
          },
        },
      },
      update: {
        plan:                 data.plan,
        status:               'ACTIVE',
        payment_id:           data.paymentId,
        pi_payment_id:        data.piPaymentId,
        current_period_start: now,
        current_period_end:   end,
        cancelled_at:         null,
        cancel_reason:        null,
        history: {
          create: {
            plan:       data.plan,
            status:     'ACTIVE',
            payment_id: data.paymentId,
            note:       `Upgraded to ${data.plan}`,
          },
        },
      },
      include: { history: { orderBy: { created_at: 'desc' }, take: 5 } },
    });

    return { ...sub, planDetails: PLANS[sub.plan] };
  }

  // ── Cancel ───────────────────────────────────────────────────
  async cancel(userId: string, reason?: string) {
    const sub = await this.prisma.subscription.findUnique({
      where: { user_id: userId },
    });

    if (!sub) throw new NotFoundException('Subscription not found');
    if (sub.plan === 'FREE') throw new BadRequestException('Cannot cancel free plan');
    if (sub.status === 'CANCELLED') throw new ConflictException('Already cancelled');

    const updated = await this.prisma.subscription.update({
      where: { user_id: userId },
      data: {
        status:        'CANCELLED',
        cancelled_at:  new Date(),
        cancel_reason: reason,
        history: {
          create: {
            plan:   sub.plan,
            status: 'CANCELLED',
            note:   reason ?? 'Cancelled by user',
          },
        },
      },
      include: { history: { orderBy: { created_at: 'desc' }, take: 5 } },
    });

    return { ...updated, planDetails: PLANS[updated.plan] };
  }

  // ── Check Feature Access ─────────────────────────────────────
  async hasAccess(userId: string, feature: string): Promise<boolean> {
    const sub = await this.getSubscription(userId);
    if (sub.status !== 'ACTIVE') return false;
    if (sub.isExpired) return false;
    return PLANS[sub.plan].features.some(f =>
      f.toLowerCase().includes(feature.toLowerCase())
    );
  }
}
