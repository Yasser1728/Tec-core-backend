import { Router } from 'express';
import { body } from 'express-validator';
import {
  register,
  login,
  logout,
  refresh,
  getMe,
} from '../controllers/auth.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

// POST /auth/register - Register a new user
router.post(
  '/register',
  [
    body('email').isEmail().normalizeEmail(),
    body('username').isLength({ min: 3, max: 30 }).trim(),
    body('password').isLength({ min: 8 }),
  ],
  register
);

// POST /auth/login - Login user
router.post(
  '/login',
  [
    body('email').isEmail().normalizeEmail(),
    body('password').notEmpty(),
  ],
  login
);

// POST /auth/logout - Logout user
router.post('/logout', authenticate, logout);

// POST /auth/refresh - Refresh access token
router.post(
  '/refresh',
  [body('refreshToken').notEmpty()],
  refresh
);

// GET /auth/me - Get current user
router.get('/me', authenticate, getMe);

export default router;