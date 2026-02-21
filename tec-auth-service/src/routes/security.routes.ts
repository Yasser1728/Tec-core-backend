import { Router } from 'express';
import { body } from 'express-validator';
import {
  get2faStatus,
  enable2fa,
  verify2fa,
  disable2fa,
  getDevices,
  removeDevice,
  getSessions,
  revokeSession,
} from '../controllers/security.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

// 2FA routes
router.get('/2fa/status', authenticate, get2faStatus);
router.post('/2fa/enable', authenticate, enable2fa);
router.post(
  '/2fa/verify',
  authenticate,
  [body('code').isString().isLength({ min: 6, max: 6 })],
  verify2fa
);
router.post('/2fa/disable', authenticate, disable2fa);

// Device management routes
router.get('/devices', authenticate, getDevices);
router.delete('/devices/:id', authenticate, removeDevice);

// Session management routes
router.get('/sessions', authenticate, getSessions);
router.delete('/sessions/:id', authenticate, revokeSession);

export default router;