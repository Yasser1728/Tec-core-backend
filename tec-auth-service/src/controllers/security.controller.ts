import { Request, Response } from 'express';
import { validationResult } from 'express-validator';
import { generateSecret, generateURI, verifySync } from 'otplib';
import QRCode from 'qrcode';
import { prisma } from '../config/database';
import { hashPassword } from '../utils/hash';

// Generate random backup codes
const generateBackupCodes = async (): Promise<string[]> => {
  const codes: string[] = [];
  for (let i = 0; i < 8; i++) {
    const code = Math.random().toString(36).substring(2, 10).toUpperCase();
    codes.push(code);
  }
  return codes;
};

// GET /security/2fa/status - Check 2FA status
export const get2faStatus = async (req: Request, res: Response): Promise<void> => {
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

    const twoFa = await prisma.twoFactorAuth.findUnique({
      where: { user_id: userId },
      select: {
        enabled: true,
        enabled_at: true,
      },
    });

    res.json({
      success: true,
      data: {
        enabled: twoFa?.enabled || false,
        enabledAt: twoFa?.enabled_at || null,
      },
    });
  } catch (error) {
    console.error('Get 2FA status error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to retrieve 2FA status',
      },
    });
  }
};

// POST /security/2fa/enable - Generate 2FA secret and QR code
export const enable2fa = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).user?.id;
    const username = (req as any).user?.username;

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

    // Check if 2FA is already enabled
    const existing = await prisma.twoFactorAuth.findUnique({
      where: { user_id: userId },
    });

    if (existing && existing.enabled) {
      res.status(400).json({
        success: false,
        error: {
          code: 'ALREADY_ENABLED',
          message: '2FA is already enabled',
        },
      });
      return;
    }

    // Generate secret
    const secret = generateSecret();

    // Generate OTP auth URL for QR code
    const otpauth = generateURI({
      issuer: 'TEC Platform',
      label: username || userId,
      secret,
    });

    // Generate QR code data URL
    const qrCodeUrl = await QRCode.toDataURL(otpauth);

    // Generate backup codes
    const backupCodes = await generateBackupCodes();
    const hashedBackupCodes = await Promise.all(
      backupCodes.map(code => hashPassword(code))
    );

    // Save to database (not enabled yet - will be enabled after verification)
    await prisma.twoFactorAuth.upsert({
      where: { user_id: userId },
      update: {
        secret,
        enabled: false,
        backup_codes: hashedBackupCodes,
      },
      create: {
        user_id: userId,
        secret,
        enabled: false,
        backup_codes: hashedBackupCodes,
      },
    });

    res.json({
      success: true,
      data: {
        secret,
        qrCode: qrCodeUrl,
        backupCodes, // Return plain codes for user to save
        message: 'Scan QR code with your authenticator app and verify to enable 2FA',
      },
    });
  } catch (error) {
    console.error('Enable 2FA error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to enable 2FA',
      },
    });
  }
};

// POST /security/2fa/verify - Verify 2FA code and enable
export const verify2fa = async (req: Request, res: Response): Promise<void> => {
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
    const { code } = req.body;

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

    const twoFa = await prisma.twoFactorAuth.findUnique({
      where: { user_id: userId },
    });

    if (!twoFa) {
      res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: '2FA not initialized. Please enable 2FA first.',
        },
      });
      return;
    }

    if (!twoFa.secret) {
      res.status(500).json({
        success: false,
        error: {
          code: 'INTERNAL_ERROR',
          message: '2FA secret is missing',
        },
      });
      return;
    }

    // Verify TOTP code
    const verificationResult = verifySync({
      token: code,
      secret: twoFa.secret,
    });

    if (!verificationResult.valid) {
      res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_CODE',
          message: 'Invalid verification code',
        },
      });
      return;
    }

    // Enable 2FA
    await prisma.twoFactorAuth.update({
      where: { user_id: userId },
      data: {
        enabled: true,
        enabled_at: new Date(),
      },
    });

    res.json({
      success: true,
      data: {
        message: '2FA enabled successfully',
      },
    });
  } catch (error) {
    console.error('Verify 2FA error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to verify 2FA code',
      },
    });
  }
};

// POST /security/2fa/disable - Disable 2FA
export const disable2fa = async (req: Request, res: Response): Promise<void> => {
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

    const twoFa = await prisma.twoFactorAuth.findUnique({
      where: { user_id: userId },
    });

    if (!twoFa || !twoFa.enabled) {
      res.status(400).json({
        success: false,
        error: {
          code: 'NOT_ENABLED',
          message: '2FA is not enabled',
        },
      });
      return;
    }

    await prisma.twoFactorAuth.update({
      where: { user_id: userId },
      data: {
        enabled: false,
        enabled_at: null,
      },
    });

    res.json({
      success: true,
      data: {
        message: '2FA disabled successfully',
      },
    });
  } catch (error) {
    console.error('Disable 2FA error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to disable 2FA',
      },
    });
  }
};

// GET /security/devices - List trusted devices
export const getDevices = async (req: Request, res: Response): Promise<void> => {
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

    const devices = await prisma.device.findMany({
      where: { user_id: userId },
      orderBy: { last_login: 'desc' },
    });

    res.json({
      success: true,
      data: {
        devices,
      },
    });
  } catch (error) {
    console.error('Get devices error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to retrieve devices',
      },
    });
  }
};

// DELETE /security/devices/:id - Remove trusted device
export const removeDevice = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).user?.id;
    const { id } = req.params;

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

    const device = await prisma.device.findUnique({
      where: { id },
    });

    if (!device || device.user_id !== userId) {
      res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Device not found',
        },
      });
      return;
    }

    await prisma.device.delete({
      where: { id },
    });

    res.json({
      success: true,
      data: {
        message: 'Device removed successfully',
      },
    });
  } catch (error) {
    console.error('Remove device error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to remove device',
      },
    });
  }
};

// GET /security/sessions - List active sessions
export const getSessions = async (req: Request, res: Response): Promise<void> => {
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

    const sessions = await prisma.session.findMany({
      where: {
        user_id: userId,
        expires_at: {
          gt: new Date(),
        },
      },
      orderBy: { created_at: 'desc' },
    });

    res.json({
      success: true,
      data: {
        sessions,
      },
    });
  } catch (error) {
    console.error('Get sessions error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to retrieve sessions',
      },
    });
  }
};

// DELETE /security/sessions/:id - Revoke session
export const revokeSession = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).user?.id;
    const { id } = req.params;

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

    const session = await prisma.session.findUnique({
      where: { id },
    });

    if (!session || session.user_id !== userId) {
      res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Session not found',
        },
      });
      return;
    }

    await prisma.session.delete({
      where: { id },
    });

    res.json({
      success: true,
      data: {
        message: 'Session revoked successfully',
      },
    });
  } catch (error) {
    console.error('Revoke session error:', error);
    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to revoke session',
      },
    });
  }
};
