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
  resolveIncompletePayment,
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
import { validateInternalKey } from '../middlewares/internal-auth';

const router = Router();

/**
 * =========================================================
 * Pi Network Webhooks
 * =========================================================
 */

router.post(
  '/webhook/incomplete',
  paymentRateLimiter,
  handleIncompletePayment
);

/**
 * =========================================================
 * Payment Creation
 * =========================================================
 */

router.post(
  '/create',
  authenticate,
  initiateRateLimiter,
  idempotency,
  [
    body('userId')
      .notEmpty()
      .withMessage('userId is required')
      .isUUID()
      .withMessage('userId must be a valid UUID'),

    body('amount')
      .notEmpty()
      .withMessage('amount is required')
      .isFloat({ min: 0.01 })
      .withMessage('amount must be greater than 0'),

    body('currency')
      .optional()
      .isString()
      .isLength({ min: 2, max: 3 })
      .withMessage('currency must be 2-3 characters')
      .toUpperCase(),

    body('payment_method')
      .notEmpty()
      .withMessage('payment_method is required')
      .toLowerCase()
      .isIn(['pi', 'card', 'wallet'])
      .withMessage('payment_method must be pi, card, or wallet'),

    body('metadata')
      .optional()
      .isObject()
      .withMessage('metadata must be JSON'),
  ],
  createPayment
);

/**
 * =========================================================
 * Payment Approval
 * =========================================================
 */

router.post(
  '/approve',
  authenticate,
  paymentRateLimiter,
  idempotency,
  [
    body('payment_id')
      .notEmpty()
      .withMessage('payment_id is required')
      .isUUID()
      .withMessage('payment_id must be UUID'),

    body('pi_payment_id')
      .optional()
      .isString()
      .trim()
      .matches(/^[a-zA-Z0-9._-]{6,128}$/)
      .withMessage('invalid pi_payment_id'),
  ],
  approvePayment
);

/**
 * =========================================================
 * Payment Completion
 * =========================================================
 */

router.post(
  '/complete',
  authenticate,
  confirmRateLimiter,
  idempotency,
  [
    body('payment_id')
      .notEmpty()
      .withMessage('payment_id is required')
      .isUUID()
      .withMessage('payment_id must be UUID'),

    body('transaction_id')
      .optional()
      .isString()
      .trim()
      .matches(/^[a-zA-Z0-9_-]{8,128}$/)
      .withMessage('transaction_id invalid format'),
  ],
  completePayment
);

/**
 * =========================================================
 * Payment Cancel
 * =========================================================
 */

router.post(
  '/cancel',
  authenticate,
  cancelRateLimiter,
  idempotency,
  [
    body('payment_id')
      .notEmpty()
      .withMessage('payment_id is required')
      .isUUID()
      .withMessage('payment_id must be UUID'),
  ],
  cancelPayment
);

/**
 * =========================================================
 * Payment Failure
 * =========================================================
 */

router.post(
  '/fail',
  authenticate,
  paymentRateLimiter,
  [
    body('payment_id')
      .notEmpty()
      .withMessage('payment_id is required')
      .isUUID()
      .withMessage('payment_id must be UUID'),

    body('reason')
      .optional()
      .isString()
      .trim()
      .isLength({ max: 200 })
      .withMessage('reason too long'),
  ],
  failPayment
);

/**
 * =========================================================
 * Resolve Incomplete Pi Payment
 * =========================================================
 */

router.post(
  '/resolve-incomplete',
  authenticate,
  paymentRateLimiter,
  [
    body('pi_payment_id')
      .notEmpty()
      .withMessage('pi_payment_id required')
      .isString()
      .trim()
      .isLength({ min: 5, max: 128 }),
  ],
  resolveIncompletePayment
);

/**
 * =========================================================
 * Payment History
 * =========================================================
 */

router.get(
  '/history',
  authenticate,
  statusRateLimiter,
  [
    query('page')
      .optional()
      .isInt({ min: 1 })
      .toInt(),

    query('limit')
      .optional()
      .isInt({ min: 1, max: 100 })
      .toInt(),

    query('status')
      .optional()
      .isIn(['created', 'approved', 'completed', 'cancelled', 'failed']),

    query('payment_method')
      .optional()
      .isIn(['pi', 'card', 'wallet']),

    query('from')
      .optional()
      .isISO8601(),

    query('to')
      .optional()
      .isISO8601(),

    query('sort')
      .optional()
      .isIn(['asc', 'desc']),
  ],
  getPaymentHistory
);

/**
 * =========================================================
 * Internal Reconciliation
 * =========================================================
 */

router.post(
  '/reconcile',
  validateInternalKey,
  paymentRateLimiter,
  triggerReconciliation
);

/**
 * =========================================================
 * Payment Status
 * =========================================================
 */

router.get(
  '/:id/status',
  authenticate,
  statusRateLimiter,
  [
    param('id')
      .notEmpty()
      .isUUID()
      .withMessage('id must be UUID'),
  ],
  getPaymentStatus
);

export default router;
