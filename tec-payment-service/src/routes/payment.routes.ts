import { Router } from 'express';
import { body, param, query } from 'express-validator';
import {
  createPayment,
  approvePayment,
  completePayment,
  cancelPayment,
  failPayment,
  getPaymentStatus,
  getPaymentHistory,
  triggerReconciliation,
} from '../controllers/payment.controller';
import { handleIncompletePayment } from '../controllers/webhook.controller';
import {
  initiateRateLimiter,
  confirmRateLimiter,
  cancelRateLimiter,
  statusRateLimiter,
  paymentRateLimiter,
} from '../middlewares/rate-limit.middleware';
import { idempotency } from '../middlewares/idempotency.middleware';
import { authenticate } from '../middlewares/jwt.middleware';
import { validateInternalKey } from '../middleware/internal-auth';

const router = Router();

// POST /payments/webhook/incomplete — Pi Network incomplete-payment notification
// No JWT or internal-key auth; validated via PI_API_KEY inside the controller.
router.post('/webhook/incomplete', handleIncompletePayment);

// POST /payments/create - Initiate a new payment
router.post(
  '/create',
  authenticate,
  initiateRateLimiter,
  idempotency,
  [
    body('userId')
      .notEmpty().withMessage('userId is required')
      .isUUID().withMessage('userId must be a valid UUID'),
    body('amount')
      .notEmpty().withMessage('amount is required')
      .isFloat({ min: 0.01 }).withMessage('amount must be greater than 0'),
    body('currency')
      .optional()
      .isString().withMessage('currency must be a string')
      .isLength({ min: 2, max: 3 }).withMessage('currency must be 2-3 characters')
      .toUpperCase(),
    body('payment_method')
      .notEmpty().withMessage('payment_method is required')
      .toLowerCase()
      .isIn(['pi', 'card', 'wallet']).withMessage('payment_method must be one of: pi, card, wallet'),
    body('metadata')
      .optional()
      .isObject().withMessage('metadata must be a valid JSON object'),
  ],
  createPayment
);

// POST /payments/approve - Approve a payment (second stage)
router.post(
  '/approve',
  authenticate,
  paymentRateLimiter,
  [
    body('payment_id')
      .notEmpty().withMessage('payment_id is required')
      .isUUID().withMessage('payment_id must be a valid UUID'),
    body('pi_payment_id')
      .optional()
      .isString().withMessage('pi_payment_id must be a string')
      .trim(),
  ],
  approvePayment
);

// POST /payments/complete - Confirm a payment (atomic, final stage)
router.post(
  '/complete',
  authenticate,
  confirmRateLimiter,
  idempotency,
  [
    body('payment_id')
      .notEmpty().withMessage('payment_id is required')
      .isUUID().withMessage('payment_id must be a valid UUID'),
    body('transaction_id')
      .optional()
      .isString().withMessage('transaction_id must be a string')
      .trim(),
  ],
  completePayment
);

// POST /payments/cancel - Cancel a payment (atomic)
router.post(
  '/cancel',
  authenticate,
  cancelRateLimiter,
  idempotency,
  [
    body('payment_id')
      .notEmpty().withMessage('payment_id is required')
      .isUUID().withMessage('payment_id must be a valid UUID'),
  ],
  cancelPayment
);

// POST /payments/fail - Record a payment failure
router.post(
  '/fail',
  authenticate,
  paymentRateLimiter,
  [
    body('payment_id')
      .notEmpty().withMessage('payment_id is required')
      .isUUID().withMessage('payment_id must be a valid UUID'),
    body('reason')
      .optional()
      .isString().withMessage('reason must be a string')
      .trim(),
  ],
  failPayment
);

// GET /payments/history - Get payment history for authenticated user
router.get(
  '/history',
  authenticate,
  statusRateLimiter,
  [
    query('page')
      .optional()
      .isInt({ min: 1 }).withMessage('page must be an integer >= 1')
      .toInt(),
    query('limit')
      .optional()
      .isInt({ min: 1, max: 100 }).withMessage('limit must be an integer between 1 and 100')
      .toInt(),
    query('status')
      .optional()
      .isIn(['created', 'approved', 'completed', 'cancelled', 'failed'])
      .withMessage('status must be one of: created, approved, completed, cancelled, failed'),
    query('payment_method')
      .optional()
      .isIn(['pi', 'card', 'wallet'])
      .withMessage('payment_method must be one of: pi, card, wallet'),
    query('from')
      .optional()
      .isISO8601().withMessage('from must be a valid ISO date string'),
    query('to')
      .optional()
      .isISO8601().withMessage('to must be a valid ISO date string'),
    query('sort')
      .optional()
      .isIn(['asc', 'desc']).withMessage('sort must be asc or desc'),
  ],
  getPaymentHistory
);

// POST /payments/reconcile - Trigger stale payment reconciliation (internal)
router.post(
  '/reconcile',
  validateInternalKey,
  paymentRateLimiter,
  triggerReconciliation
);

// GET /payments/:id/status - Get payment status
router.get(
  '/:id/status',
  authenticate,
  statusRateLimiter,
  [
    param('id')
      .notEmpty().withMessage('id is required')
      .isUUID().withMessage('id must be a valid UUID')
  ],
  getPaymentStatus
);

export default router;