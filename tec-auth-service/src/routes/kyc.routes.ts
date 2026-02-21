import { Router } from 'express';
import { body } from 'express-validator';
import {
  getKycStatus,
  submitKyc,
  verifyKyc,
} from '../controllers/kyc.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

// GET /kyc/status - Get KYC verification status
router.get('/status', authenticate, getKycStatus);

// POST /kyc/submit - Submit KYC verification data
router.post(
  '/submit',
  authenticate,
  [
    body('fullName').isString().trim().isLength({ min: 2, max: 100 }),
    body('dateOfBirth').isISO8601().toDate(),
    body('country').isString().trim().isLength({ min: 2, max: 2 }),
    body('documentType').isString().isIn(['passport', 'national_id', 'driver_license']),
    body('documentId').isString().trim().isLength({ min: 5, max: 50 }),
  ],
  submitKyc
);

// POST /kyc/verify - Verify KYC (admin only)
router.post(
  '/verify',
  authenticate,
  [
    body('userId').isUUID(),
    body('approved').isBoolean(),
    body('rejectionNote').optional().isString(),
  ],
  verifyKyc
);

export default router;