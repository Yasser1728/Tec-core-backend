import { Request, Response } from 'express';
import { prisma } from '../config/database';
import { generateTokens } from '../utils/jwt';
import { logAudit } from '../utils/logger';

const PI_API_BASE =
  process.env.PI_SANDBOX === 'false'
    ? 'https://api.minepi.com'
    : 'https://api.sandbox.minepi.com';

// POST /auth/pi-login — Authenticate (or register) a user via Pi Network access token
export const piLogin = async (req: Request, res: Response): Promise<void> => {
  try {
    const { accessToken } = req.body;

    if (!accessToken) {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'accessToken is required' },
      });
      return;
    }

    // Step 1: Verify the Pi access token with Pi Network API
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let piResponse: any;
    try {
      piResponse = await fetch(`${PI_API_BASE}/v2/me`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
    } catch (networkError) {
      console.error('Pi Network API unreachable:', networkError);
      res.status(503).json({
        success: false,
        error: { code: 'PI_SERVICE_UNAVAILABLE', message: 'Pi Network API is currently unavailable' },
      });
      return;
    }

    if (!piResponse.ok) {
      res.status(401).json({
        success: false,
        error: { code: 'INVALID_TOKEN', message: 'Invalid Pi access token' },
      });
      return;
    }

    const piUser = await piResponse.json() as { uid?: string; username?: string };
    const verifiedUid = piUser.uid;
    const verifiedUsername = piUser.username ?? '';

    if (!verifiedUid) {
      res.status(401).json({
        success: false,
        error: { code: 'INVALID_TOKEN', message: 'Invalid Pi access token' },
      });
      return;
    }

    // Step 2: Find or create user by pi_uid
    let user = await prisma.user.findFirst({ where: { pi_uid: verifiedUid } });
    let isNewUser = false;

    if (!user) {
      user = await prisma.user.create({
        data: {
          pi_uid: verifiedUid,
          pi_username: verifiedUsername || null,
          username: verifiedUsername || `pi_${verifiedUid}`,
          role: 'user',
          kyc_status: 'pending',
        },
      });
      isNewUser = true;
    } else if (verifiedUsername && user.pi_username !== verifiedUsername) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { pi_username: verifiedUsername },
      });
    }

    // Step 3: Generate JWT tokens
    const { accessToken: jwtAccessToken, refreshToken } = generateTokens(user.id);

    // Step 4: Persist the refresh token
    await prisma.refreshToken.create({
      data: {
        user_id: user.id,
        token: refreshToken,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        device: req.headers['user-agent'],
        ip_address: req.ip,
      },
    });

    logAudit('PI_LOGIN', { userId: user.id, piUid: verifiedUid, isNewUser, ipAddress: req.ip });

    // Step 5: Return response (omit password_hash)
    const { password_hash, ...userWithoutPassword } = user;

    res.status(isNewUser ? 201 : 200).json({
      success: true,
      data: {
        user: {
          ...userWithoutPassword,
          piUsername: user.pi_username,
          piUid: user.pi_uid,
        },
        tokens: {
          accessToken: jwtAccessToken,
          refreshToken,
        },
        isNewUser,
      },
    });
  } catch (error) {
    console.error('Pi login error:', error);
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Pi authentication failed' },
    });
  }
};
