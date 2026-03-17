// src/controllers/security.controller.ts
import { Request, Response } from 'express';
import { validationResult } from 'express-validator';
import { authenticator } from 'otplib';
import * as QRCode from 'qrcode';
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

// GET /security/2fa/status
export const get2faStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: { message: 'Unauthorized' } });

    const twoFa = await prisma.twoFactorAuth.findUnique({
      where: { user_id: userId },
      select: { enabled: true, enabled_at: true },
    });

    res.json({
      success: true,
      data: { enabled: twoFa?.enabled || false, enabledAt: twoFa?.enabled_at || null },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: { message: 'Internal Error' } });
  }
};

// POST /security/2fa/enable
export const enable2fa = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: { message: 'Unauthorized' } });

    const userRecord = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, pi_username: true },
    });
    const label = userRecord?.pi_username || userRecord?.email || 'TEC_User';

    const secret = authenticator.generateSecret();
    const otpauth = authenticator.keyuri(label, 'TEC Platform', secret);
    const qrCodeUrl = await QRCode.toDataURL(otpauth);

    const backupCodes = await generateBackupCodes();
    const hashedBackupCodes = await Promise.all(backupCodes.map(code => hashPassword(code)));

    await prisma.twoFactorAuth.upsert({
      where: { user_id: userId },
      update: { secret, enabled: false, backup_codes: hashedBackupCodes },
      create: { user_id: userId, secret, enabled: false, backup_codes: hashedBackupCodes },
    });

    res.json({
      success: true,
      data: { secret, qrCode: qrCodeUrl, backupCodes },
    });
  } catch (error) {
    res.status(500).json({ success: false, error: { message: 'Failed to initiate 2FA' } });
  }
};

// POST /security/2fa/verify
export const verify2fa = async (req: Request, res: Response): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ success: false, error: { message: 'Invalid input', details: errors.array() } });

    const userId = req.user?.id;
    const { code } = req.body;
    if (!userId) return res.status(401).json({ success: false, error: { message: 'Unauthorized' } });

    const twoFa = await prisma.twoFactorAuth.findUnique({ where: { user_id: userId } });
    if (!twoFa || !twoFa.secret) return res.status(404).json({ success: false, error: { message: '2FA not setup' } });

    const isValid = authenticator.check(code, twoFa.secret);
    if (!isValid) return res.status(400).json({ success: false, error: { message: 'Invalid code' } });

    await prisma.twoFactorAuth.update({ where: { user_id: userId }, data: { enabled: true, enabled_at: new Date() } });

    res.json({ success: true, data: { message: '2FA enabled successfully' } });
  } catch (error) {
    res.status(500).json({ success: false, error: { message: 'Verification failed' } });
  }
};

// POST /security/2fa/disable
export const disable2fa = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: { message: 'Unauthorized' } });

    const twoFa = await prisma.twoFactorAuth.findUnique({ where: { user_id: userId } });
    if (!twoFa || !twoFa.enabled) return res.status(400).json({ success: false, error: { message: '2FA is not enabled' } });

    await prisma.twoFactorAuth.update({ where: { user_id: userId }, data: { enabled: false, enabled_at: null } });

    res.json({ success: true, data: { message: '2FA disabled successfully' } });
  } catch (error) {
    res.status(500).json({ success: false, error: { message: 'Failed to disable 2FA' } });
  }
};

// GET /security/devices
export const getDevices = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: { message: 'Unauthorized' } });

    const devices = await prisma.device.findMany({ where: { user_id: userId }, orderBy: { last_login: 'desc' } });
    res.json({ success: true, data: { devices } });
  } catch (error) {
    res.status(500).json({ success: false, error: { message: 'Failed to retrieve devices' } });
  }
};

// DELETE /security/devices/:id
export const removeDevice = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    const { id } = req.params;
    if (!userId) return res.status(401).json({ success: false, error: { message: 'Unauthorized' } });

    const device = await prisma.device.findUnique({ where: { id } });
    if (!device || device.user_id !== userId) return res.status(404).json({ success: false, error: { message: 'Device not found' } });

    await prisma.device.delete({ where: { id } });
    res.json({ success: true, data: { message: 'Device removed successfully' } });
  } catch (error) {
    res.status(500).json({ success: false, error: { message: 'Failed to remove device' } });
  }
};

// GET /security/sessions
export const getSessions = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: { message: 'Unauthorized' } });

    const sessions = await prisma.session.findMany({ where: { user_id: userId, expires_at: { gt: new Date() } }, orderBy: { created_at: 'desc' } });
    res.json({ success: true, data: { sessions } });
  } catch (error) {
    res.status(500).json({ success: false, error: { message: 'Failed to retrieve sessions' } });
  }
};

// DELETE /security/sessions/:id
export const revokeSession = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.user?.id;
    const { id } = req.params;
    if (!userId) return res.status(401).json({ success: false, error: { message: 'Unauthorized' } });

    const session = await prisma.session.findUnique({ where: { id } });
    if (!session || session.user_id !== userId) return res.status(404).json({ success: false, error: { message: 'Session not found' } });

    await prisma.session.delete({ where: { id } });
    res.json({ success: true, data: { message: 'Session revoked successfully' } });
  } catch (error) {
    res.status(500).json({ success: false, error: { message: 'Failed to revoke session' } });
  }
};
