import { Router } from 'express';
import { body } from 'express-validator';
import {
  getPlans,
  getSubscriptionStatus,
  subscribe,
  cancelSubscription,
  upgradeSubscription,
} from '../controllers/subscription.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

// GET /subscriptions/plans - List all subscription plans (public)
router.get('/plans', getPlans);

// GET /subscriptions/status - Get current user subscription status
router.get('/status', authenticate, getSubscriptionStatus);

// POST /subscriptions/subscribe - Subscribe to a plan
router.post(
  '/subscribe',
  authenticate,
  [body('planName').isString().isIn(['Free', 'Pro', 'Enterprise'])],
  subscribe
);

// POST /subscriptions/cancel - Cancel subscription
router.post('/cancel', authenticate, cancelSubscription);

// POST /subscriptions/upgrade - Upgrade subscription plan
router.post(
  '/upgrade',
  authenticate,
  [body('planName').isString().isIn(['Free', 'Pro', 'Enterprise'])],
  upgradeSubscription
);

export default router;