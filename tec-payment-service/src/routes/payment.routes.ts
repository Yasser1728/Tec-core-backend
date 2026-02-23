import { Router } from 'express';
import { body, param } from 'express-validator';
import {
  createPayment,
  approvePayment,
  completePayment,
  cancelPayment,
  failPayment,
  getPaymentStatus,
} from '../controllers/payment.controller';
import {
  initiateRateLimiter,
  confirmRateLimiter,
  cancelRateLimiter,
  statusRateLimiter,
  paymentRateLimiter,
} from '../middlewares/rate-limit.middleware';
import { idempotency } from '../middlewares/idempotency.middleware';
import { authenticate } from '../middlewares/jwt.middleware';

const router = Router();

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