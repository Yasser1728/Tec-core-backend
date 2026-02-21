import { Router } from 'express';
import { body } from 'express-validator';
import {
  getProfile,
  updateProfile,
  changePassword,
  deleteAccount,
} from '../controllers/profile.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

// GET /profile - Get user profile
router.get('/', authenticate, getProfile);

// PUT /profile - Update user profile
router.put(
  '/',
  authenticate,
  [
    body('email').optional().isEmail().normalizeEmail(),
    body('username').optional().isLength({ min: 3, max: 30 }).trim(),
  ],
  updateProfile
);

// PUT /profile/password - Change password
router.put(
  '/password',
  authenticate,
  [
    body('currentPassword').notEmpty(),
    body('newPassword').isLength({ min: 8 }),
  ],
  changePassword
);

// DELETE /profile - Delete account
router.delete('/', authenticate, deleteAccount);

export default router;