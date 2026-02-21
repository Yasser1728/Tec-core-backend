import { Request, Response } from 'express';
import { validationResult } from 'express-validator';
import { prisma } from '../config/database';

// Subscription plans configuration
const PLANS = [
  {
    name: 'Free',
    description: 'Essential access for individual users',
    price: 0,
    currency: 'PI',
    features: [
      '1 app access',
      'Basic features',
      'Community support',
      'Standard security',
    ],
    duration: 30,
  },
  {
    name: 'Pro',
    description: 'Advanced features for power users',
    price: 5,
    currency: 'PI',
    features: [
      '10 app access',
      'Priority support',
      'Advanced analytics',
      'Custom integrations',
      'Enhanced security',
    ],
    duration: 30,
  },
  {
    name: 'Enterprise',
    description: 'Full platform access for organizations',
    price: 25,
    currency: 'PI',
    features: [
      'All 24 apps access',
      'Dedicated support',
      'Custom API access',
      'White-label options',
      'Advanced security + 2FA',
      'Priority feature requests',
    ],
    duration: 30,
  },
];

// GET /subscriptions/plans - List all subscription plans
export const getPlans = async (req: Request, res: Response): Promise<void> => {
  try {
    res.json({
      success: true,
      data: {
        plans: PLANS,
      },
    });
  } catch (error) {
    console.error('Get plans error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to retrieve subscription plans',
      },
    });
  }
};

// GET /subscriptions/status - Get current user subscription status
export const getSubscriptionStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).user?.id;

    if (!userId) {
      res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'User not authenticated',
        },
      });
      return;
    }

    // Get active subscription
    const subscription = await prisma.subscription.findFirst({
      where: {
        user_id: userId,
        status: 'active',
      },
      include: {
        plan: true,
      },
      orderBy: {
        created_at: 'desc',
      },
    });

    // Get payment history for this user
    const payments = await prisma.payment.findMany({
      where: {
        user_id: userId,
        metadata: {
          path: ['type'],
          equals: 'subscription',
        },
      },
      orderBy: {
        created_at: 'desc',
      },
      take: 10,
    });

    res.json({
      success: true,
      data: {
        subscription: subscription || null,
        plan: subscription?.plan || PLANS[0], // Default to Free plan
        nextBillingDate: subscription?.end_date || null,
        autoRenew: subscription?.auto_renew ?? false,
        paymentHistory: payments,
      },
    });
  } catch (error) {
    console.error('Get subscription status error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to retrieve subscription status',
      },
    });
  }
};

// POST /subscriptions/subscribe - Subscribe to a plan
export const subscribe = async (req: Request, res: Response): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid input data',
          details: errors.array(),
        },
      });
      return;
    }

    const userId = (req as any).user?.id;
    const { planName } = req.body;

    if (!userId) {
      res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'User not authenticated',
        },
      });
      return;
    }

    // Validate plan
    const planConfig = PLANS.find(p => p.name === planName);
    if (!planConfig) {
      res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_PLAN',
          message: 'Invalid plan selected',
        },
      });
      return;
    }

    // Find or create plan in database
    let plan = await prisma.plan.findUnique({
      where: { name: planName },
    });

    if (!plan) {
      plan = await prisma.plan.create({
        data: {
          name: planConfig.name,
          description: planConfig.description,
          price: planConfig.price,
          currency: planConfig.currency,
          features: planConfig.features,
          duration: planConfig.duration,
        },
      });
    }

    // Cancel any existing active subscriptions
    await prisma.subscription.updateMany({
      where: {
        user_id: userId,
        status: 'active',
      },
      data: {
        status: 'cancelled',
      },
    });

    // Create new subscription
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + planConfig.duration);

    const subscription = await prisma.subscription.create({
      data: {
        user_id: userId,
        plan_id: plan.id,
        status: 'active',
        end_date: endDate,
        auto_renew: true,
      },
      include: {
        plan: true,
      },
    });

    res.status(201).json({
      success: true,
      data: {
        subscription,
        message: `Successfully subscribed to ${planName} plan`,
      },
    });
  } catch (error) {
    console.error('Subscribe error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to create subscription',
      },
    });
  }
};

// POST /subscriptions/cancel - Cancel subscription
export const cancelSubscription = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).user?.id;

    if (!userId) {
      res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'User not authenticated',
        },
      });
      return;
    }

    const subscription = await prisma.subscription.findFirst({
      where: {
        user_id: userId,
        status: 'active',
      },
    });

    if (!subscription) {
      res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'No active subscription found',
        },
      });
      return;
    }

    const updated = await prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        status: 'cancelled',
        auto_renew: false,
      },
      include: {
        plan: true,
      },
    });

    res.json({
      success: true,
      data: {
        subscription: updated,
        message: 'Subscription cancelled successfully',
      },
    });
  } catch (error) {
    console.error('Cancel subscription error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to cancel subscription',
      },
    });
  }
};

// POST /subscriptions/upgrade - Upgrade subscription plan
export const upgradeSubscription = async (req: Request, res: Response): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid input data',
          details: errors.array(),
        },
      });
      return;
    }

    const userId = (req as any).user?.id;
    const { planName } = req.body;

    if (!userId) {
      res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHORIZED',
          message: 'User not authenticated',
        },
      });
      return;
    }

    // Validate plan
    const planConfig = PLANS.find(p => p.name === planName);
    if (!planConfig) {
      res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_PLAN',
          message: 'Invalid plan selected',
        },
      });
      return;
    }

    // This is essentially the same as subscribe - cancel old and create new
    // In a real implementation, you might prorate the remaining time
    let plan = await prisma.plan.findUnique({
      where: { name: planName },
    });

    if (!plan) {
      plan = await prisma.plan.create({
        data: {
          name: planConfig.name,
          description: planConfig.description,
          price: planConfig.price,
          currency: planConfig.currency,
          features: planConfig.features,
          duration: planConfig.duration,
        },
      });
    }

    await prisma.subscription.updateMany({
      where: {
        user_id: userId,
        status: 'active',
      },
      data: {
        status: 'cancelled',
      },
    });

    const endDate = new Date();
    endDate.setDate(endDate.getDate() + planConfig.duration);

    const subscription = await prisma.subscription.create({
      data: {
        user_id: userId,
        plan_id: plan.id,
        status: 'active',
        end_date: endDate,
        auto_renew: true,
      },
      include: {
        plan: true,
      },
    });

    res.json({
      success: true,
      data: {
        subscription,
        message: `Successfully upgraded to ${planName} plan`,
      },
    });
  } catch (error) {
    console.error('Upgrade subscription error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to upgrade subscription',
      },
    });
  }
};
