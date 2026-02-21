import request from 'supertest';
import express from 'express';
import { body, param, validationResult } from 'express-validator';

// Mock prisma client
const mockPrismaClient = {
  payment: {
    create: jest.fn(),
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  $queryRaw: jest.fn(),
};

// Mock the database module
jest.mock('../../src/config/database', () => ({
  prisma: mockPrismaClient,
}));

// Import after mocking
import {
  createPayment,
  approvePayment,
  completePayment,
  cancelPayment,
  failPayment,
  getPaymentStatus,
} from '../../src/controllers/payment.controller';

// Test app setup
const app = express();
app.use(express.json());

// Routes
app.post(
  '/payments/create',
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

app.post(
  '/payments/approve',
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

app.post(
  '/payments/complete',
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

app.post(
  '/payments/cancel',
  [
    body('payment_id')
      .notEmpty().withMessage('payment_id is required')
      .isUUID().withMessage('payment_id must be a valid UUID'),
  ],
  cancelPayment
);

app.post(
  '/payments/fail',
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

app.get('/payments/:id/status', [
  param('id')
    .notEmpty().withMessage('id is required')
    .isUUID().withMessage('id must be a valid UUID')
], getPaymentStatus);

describe('Payment Service Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /payments/create', () => {
    const validPaymentData = {
      userId: '123e4567-e89b-12d3-a456-426614174000',
      amount: 10.5,
      currency: 'PI',
      payment_method: 'pi',
      metadata: { description: 'Test payment' },
    };

    it('should create a payment successfully', async () => {
      const mockPayment = {
        id: '123e4567-e89b-12d3-a456-426614174001',
        user_id: validPaymentData.userId,
        amount: validPaymentData.amount,
        currency: validPaymentData.currency,
        status: 'created',
        payment_method: validPaymentData.payment_method,
        metadata: validPaymentData.metadata,
        created_at: new Date(),
        updated_at: new Date(),
      };

      mockPrismaClient.payment.create.mockResolvedValue(mockPayment);

      const response = await request(app)
        .post('/payments/create')
        .send(validPaymentData);

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.payment).toMatchObject({
        id: mockPayment.id,
        user_id: validPaymentData.userId,
        amount: validPaymentData.amount,
        status: 'created',
      });
    });

    it('should return 400 for missing userId', async () => {
      const invalidData = { ...validPaymentData, userId: undefined };

      const response = await request(app)
        .post('/payments/create')
        .send(invalidData);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for invalid amount (zero)', async () => {
      const invalidData = { ...validPaymentData, amount: 0 };

      const response = await request(app)
        .post('/payments/create')
        .send(invalidData);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for invalid payment_method', async () => {
      const invalidData = { ...validPaymentData, payment_method: 'invalid' };

      const response = await request(app)
        .post('/payments/create')
        .send(invalidData);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('should return 400 for invalid userId format', async () => {
      const invalidData = { ...validPaymentData, userId: 'not-a-uuid' };

      const response = await request(app)
        .post('/payments/create')
        .send(invalidData);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });
  });

  describe('POST /payments/approve', () => {
    const validApprovalData = {
      payment_id: '123e4567-e89b-12d3-a456-426614174001',
      pi_payment_id: 'pi_123456',
    };

    it('should approve a payment successfully', async () => {
      const mockPayment = {
        id: validApprovalData.payment_id,
        user_id: '123e4567-e89b-12d3-a456-426614174000',
        amount: 10.5,
        currency: 'PI',
        status: 'created',
        payment_method: 'pi',
        created_at: new Date(),
        updated_at: new Date(),
      };

      const mockUpdatedPayment = {
        ...mockPayment,
        status: 'approved',
        pi_payment_id: validApprovalData.pi_payment_id,
        approved_at: new Date(),
      };

      mockPrismaClient.payment.findUnique.mockResolvedValue(mockPayment);
      mockPrismaClient.payment.update.mockResolvedValue(mockUpdatedPayment);

      const response = await request(app)
        .post('/payments/approve')
        .send(validApprovalData);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.payment.status).toBe('approved');
    });

    it('should return 404 if payment not found', async () => {
      mockPrismaClient.payment.findUnique.mockResolvedValue(null);

      const response = await request(app)
        .post('/payments/approve')
        .send(validApprovalData);

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('NOT_FOUND');
    });

    it('should return 400 if payment is not in created status', async () => {
      const mockPayment = {
        id: validApprovalData.payment_id,
        status: 'approved',
      };

      mockPrismaClient.payment.findUnique.mockResolvedValue(mockPayment);

      const response = await request(app)
        .post('/payments/approve')
        .send(validApprovalData);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('INVALID_STATUS');
    });

    it('should return 400 for invalid payment_id format', async () => {
      const invalidData = { ...validApprovalData, payment_id: 'not-a-uuid' };

      const response = await request(app)
        .post('/payments/approve')
        .send(invalidData);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });
  });

  describe('POST /payments/complete', () => {
    const validCompletionData = {
      payment_id: '123e4567-e89b-12d3-a456-426614174001',
      transaction_id: 'tx_123456',
    };

    it('should complete a payment successfully', async () => {
      const mockPayment = {
        id: validCompletionData.payment_id,
        user_id: '123e4567-e89b-12d3-a456-426614174000',
        amount: 10.5,
        currency: 'PI',
        status: 'approved',
        payment_method: 'pi',
        metadata: {},
        created_at: new Date(),
        approved_at: new Date(),
        updated_at: new Date(),
      };

      const mockUpdatedPayment = {
        ...mockPayment,
        status: 'completed',
        completed_at: new Date(),
        metadata: {
          transaction_id: validCompletionData.transaction_id,
        },
      };

      mockPrismaClient.payment.findUnique.mockResolvedValue(mockPayment);
      mockPrismaClient.payment.update.mockResolvedValue(mockUpdatedPayment);

      const response = await request(app)
        .post('/payments/complete')
        .send(validCompletionData);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.payment.status).toBe('completed');
    });

    it('should return 404 if payment not found', async () => {
      mockPrismaClient.payment.findUnique.mockResolvedValue(null);

      const response = await request(app)
        .post('/payments/complete')
        .send(validCompletionData);

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('NOT_FOUND');
    });

    it('should return 400 if payment is not in approved status', async () => {
      const mockPayment = {
        id: validCompletionData.payment_id,
        status: 'created',
      };

      mockPrismaClient.payment.findUnique.mockResolvedValue(mockPayment);

      const response = await request(app)
        .post('/payments/complete')
        .send(validCompletionData);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('INVALID_STATUS');
    });
  });

  describe('GET /payments/:id/status', () => {
    const paymentId = '123e4567-e89b-12d3-a456-426614174001';

    it('should get payment status successfully', async () => {
      const mockPayment = {
        id: paymentId,
        status: 'completed',
        amount: 10.5,
        currency: 'PI',
        payment_method: 'pi',
        created_at: new Date(),
        approved_at: new Date(),
        completed_at: new Date(),
        updated_at: new Date(),
      };

      mockPrismaClient.payment.findUnique.mockResolvedValue(mockPayment);

      const response = await request(app).get(`/payments/${paymentId}/status`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.payment).toMatchObject({
        id: paymentId,
        status: 'completed',
      });
    });

    it('should return 404 if payment not found', async () => {
      mockPrismaClient.payment.findUnique.mockResolvedValue(null);

      const response = await request(app).get(`/payments/${paymentId}/status`);

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('NOT_FOUND');
    });

    it('should return 400 for invalid payment ID format', async () => {
      const response = await request(app).get('/payments/not-a-uuid/status');

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });
  });

  describe('POST /payments/cancel', () => {
    const validCancelData = {
      payment_id: '123e4567-e89b-12d3-a456-426614174001',
    };

    it('should cancel a payment in created status successfully', async () => {
      const mockPayment = {
        id: validCancelData.payment_id,
        user_id: '123e4567-e89b-12d3-a456-426614174000',
        amount: 10.5,
        currency: 'PI',
        status: 'created',
        payment_method: 'pi',
        created_at: new Date(),
        updated_at: new Date(),
      };

      const mockUpdatedPayment = {
        ...mockPayment,
        status: 'cancelled',
        cancelled_at: new Date(),
      };

      mockPrismaClient.payment.findUnique.mockResolvedValue(mockPayment);
      mockPrismaClient.payment.update.mockResolvedValue(mockUpdatedPayment);

      const response = await request(app)
        .post('/payments/cancel')
        .send(validCancelData);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.payment.status).toBe('cancelled');
    });

    it('should cancel a payment in approved status successfully', async () => {
      const mockPayment = {
        id: validCancelData.payment_id,
        status: 'approved',
        created_at: new Date(),
        updated_at: new Date(),
      };

      const mockUpdatedPayment = {
        ...mockPayment,
        status: 'cancelled',
        cancelled_at: new Date(),
      };

      mockPrismaClient.payment.findUnique.mockResolvedValue(mockPayment);
      mockPrismaClient.payment.update.mockResolvedValue(mockUpdatedPayment);

      const response = await request(app)
        .post('/payments/cancel')
        .send(validCancelData);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.payment.status).toBe('cancelled');
    });

    it('should return 404 if payment not found', async () => {
      mockPrismaClient.payment.findUnique.mockResolvedValue(null);

      const response = await request(app)
        .post('/payments/cancel')
        .send(validCancelData);

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('NOT_FOUND');
    });

    it('should return 400 if payment is already completed', async () => {
      const mockPayment = {
        id: validCancelData.payment_id,
        status: 'completed',
      };

      mockPrismaClient.payment.findUnique.mockResolvedValue(mockPayment);

      const response = await request(app)
        .post('/payments/cancel')
        .send(validCancelData);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('INVALID_STATUS');
    });

    it('should return 400 if payment is already cancelled', async () => {
      const mockPayment = {
        id: validCancelData.payment_id,
        status: 'cancelled',
      };

      mockPrismaClient.payment.findUnique.mockResolvedValue(mockPayment);

      const response = await request(app)
        .post('/payments/cancel')
        .send(validCancelData);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('INVALID_STATUS');
    });

    it('should return 400 for invalid payment_id format', async () => {
      const response = await request(app)
        .post('/payments/cancel')
        .send({ payment_id: 'not-a-uuid' });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('POST /payments/fail', () => {
    const validFailData = {
      payment_id: '123e4567-e89b-12d3-a456-426614174001',
      reason: 'Payment declined by Pi Network',
    };

    it('should record payment failure successfully', async () => {
      const mockPayment = {
        id: validFailData.payment_id,
        user_id: '123e4567-e89b-12d3-a456-426614174000',
        amount: 10.5,
        currency: 'PI',
        status: 'approved',
        payment_method: 'pi',
        metadata: {},
        created_at: new Date(),
        updated_at: new Date(),
      };

      const mockUpdatedPayment = {
        ...mockPayment,
        status: 'failed',
        failed_at: new Date(),
        metadata: { failure_reason: validFailData.reason },
      };

      mockPrismaClient.payment.findUnique.mockResolvedValue(mockPayment);
      mockPrismaClient.payment.update.mockResolvedValue(mockUpdatedPayment);

      const response = await request(app)
        .post('/payments/fail')
        .send(validFailData);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.payment.status).toBe('failed');
    });

    it('should record failure without reason', async () => {
      const mockPayment = {
        id: validFailData.payment_id,
        status: 'created',
        metadata: {},
        created_at: new Date(),
        updated_at: new Date(),
      };

      const mockUpdatedPayment = {
        ...mockPayment,
        status: 'failed',
        failed_at: new Date(),
      };

      mockPrismaClient.payment.findUnique.mockResolvedValue(mockPayment);
      mockPrismaClient.payment.update.mockResolvedValue(mockUpdatedPayment);

      const response = await request(app)
        .post('/payments/fail')
        .send({ payment_id: validFailData.payment_id });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.payment.status).toBe('failed');
    });

    it('should return 404 if payment not found', async () => {
      mockPrismaClient.payment.findUnique.mockResolvedValue(null);

      const response = await request(app)
        .post('/payments/fail')
        .send(validFailData);

      expect(response.status).toBe(404);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('NOT_FOUND');
    });

    it('should return 400 if payment is already failed', async () => {
      const mockPayment = {
        id: validFailData.payment_id,
        status: 'failed',
      };

      mockPrismaClient.payment.findUnique.mockResolvedValue(mockPayment);

      const response = await request(app)
        .post('/payments/fail')
        .send(validFailData);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('INVALID_STATUS');
    });

    it('should return 400 if payment is already completed', async () => {
      const mockPayment = {
        id: validFailData.payment_id,
        status: 'completed',
      };

      mockPrismaClient.payment.findUnique.mockResolvedValue(mockPayment);

      const response = await request(app)
        .post('/payments/fail')
        .send(validFailData);

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('INVALID_STATUS');
    });

    it('should return 400 for invalid payment_id format', async () => {
      const response = await request(app)
        .post('/payments/fail')
        .send({ payment_id: 'not-a-uuid' });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    });
  });
});
