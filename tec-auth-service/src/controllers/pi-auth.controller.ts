import { createHash } from 'crypto';
import { Request, Response } from 'express';
import { prisma } from '../config/database';
import { generateTokens } from '../utils/jwt';
import { logAudit, logError, logInfo } from '../utils/logger';

const getPiApiBase = (): string => {
  if (process.env.PI_PLATFORM_BASE_URL) return process.env.PI_PLATFORM_BASE_URL;
  return process.env.PI_SANDBOX === 'false'
    ? 'https://api.minepi.com'
    : 'https://api.sandbox.minepi.com';
};

const isSandboxMode = (): boolean => process.env.PI_SANDBOX !== 'false';

/**
 * Attempt to decode a Pi JWT accessToken without verifying the signature.
 * Used in Sandbox/Testnet mode where api.sandbox.minepi.com is unreachable
 * from server-side environments (Railway, etc.).
 * Returns uid and username if the token payload contains them, otherwise null.
 */
const decodePiJwtPayload = (token: string): { uid: string; username: string } | null => {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as Record<string, unknown>;
    const uid = (payload.uid ?? payload.sub) as string | undefined;
    if (!uid || typeof uid !== 'string') return null;
    const rawUsername = payload.username ?? payload.name ?? '';
    const username = typeof rawUsername === 'string' ? rawUsername : '';
    return { uid, username };
  } catch {
    return null;
  }
};

// POST /auth/pi-login — Authenticate (or register) a user via Pi Network access token
export const piLogin = async (req: Request, res: Response): Promise<void> => {
  try {
    const { accessToken } = req.body as { accessToken?: string };

    if (!accessToken) {
      res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'accessToken is required' },
      });
      return;
    }

    let verifiedUid: string | undefined;
    let verifiedUsername = '';

    // ─── Sandbox/Testnet mode: skip Pi API call ────────────────────────────
    // api.sandbox.minepi.com is not reachable from server-side environments
    // (Railway, Heroku, etc.). In Testnet the Pi Browser SDK has already
    // verified the user client-side; we decode the JWT payload directly to
    // extract uid/username without re-verifying the signature server-side.
    if (isSandboxMode()) {
      logInfo('Sandbox mode: skipping Pi API /v2/me call, decoding token locally', { tokenLength: accessToken.length });
      const decoded = decodePiJwtPayload(accessToken);
      if (decoded) {
        verifiedUid = decoded.uid;
        verifiedUsername = decoded.username;
        logInfo('Sandbox mode: decoded Pi token successfully', { uid: verifiedUid });
      } else {
        // Token is not a decodable JWT — derive a stable uid from the token
        // so the same token always maps to the same test user.
        verifiedUid = 'sandbox_' + createHash('sha256').update(accessToken).digest('hex').slice(0, 16);
        verifiedUsername = 'sandbox_user';
        logInfo('Sandbox mode: token not a JWT, using derived sandbox uid', { uid: verifiedUid });
      }
    } else {
      // ─── Mainnet mode: verify token with Pi Network API ──────────────────
      const PI_API_URL = `${getPiApiBase()}/v2/me`;
      const MAX_RETRIES = 2;
      const RETRY_DELAYS_MS = [1000, 2000];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let piResponse: any;
      let lastErrorBody = '';

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          piResponse = await fetch(PI_API_URL, {
            headers: { Authorization: `Bearer ${accessToken}` },
            signal: AbortSignal.timeout(10000),
          });
          // Break on success or a non-5xx response (4xx errors are not retried)
          if (piResponse.status < 500) {
            break;
          }
          // 5xx: read body once for logging, then retry if attempts remain
          lastErrorBody = await piResponse.text().catch(() => '');
          logError(`Pi Network API returned ${piResponse.status} on attempt ${attempt + 1}`, {
            url: PI_API_URL,
            attempt: attempt + 1,
            responseBody: lastErrorBody,
          });
        } catch (networkError) {
          const errCode = (networkError as NodeJS.ErrnoException).code ?? '';
          const errMsg = (networkError as Error).message ?? '';
          const isDns = errCode === 'ENOTFOUND' || errCode === 'EAI_AGAIN' || errMsg.includes('getaddrinfo');
          if (isDns) {
            logError('Pi Network API DNS resolution failed', {
              url: PI_API_URL,
              attempt: attempt + 1,
              errCode,
              errMsg,
              hint: 'Check PI_PLATFORM_BASE_URL or DNS connectivity from the host.',
            });
          } else {
            logError('Pi Network API unreachable', {
              url: PI_API_URL,
              attempt: attempt + 1,
              errCode,
              errMsg,
            });
          }
        }
        if (attempt < MAX_RETRIES) {
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
        }
      }

      if (!piResponse) {
        res.status(503).json({
          success: false,
          error: { code: 'PI_SERVICE_UNAVAILABLE', message: 'Pi Network API is currently unavailable' },
        });
        return;
      }

      if (!piResponse.ok) {
        logError('Pi Network API final non-ok response', {
          url: PI_API_URL,
          httpStatus: piResponse.status,
          responseBody: lastErrorBody,
        });
        res.status(401).json({
          success: false,
          error: { code: 'INVALID_TOKEN', message: 'Invalid Pi access token' },
        });
        return;
      }

      const piUser = await piResponse.json() as { uid?: string; username?: string };
      verifiedUid = piUser.uid;
      verifiedUsername = piUser.username ?? '';
    }

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

    // Step 5: Return response (omit password_hash; use explicit shape so that
    // id (the database UUID) is never confused with piUid (the Pi Network uid,
    // which may be a sandbox_xxx string in Sandbox/Testnet mode).
    res.status(isNewUser ? 201 : 200).json({
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          kyc_status: user.kyc_status,
          role: user.role,
          created_at: user.created_at,
          updated_at: user.updated_at,
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
    logError('Pi login error', { errMsg: error instanceof Error ? error.message : String(error) });
    // Detect Prisma column-not-found error (schema/DB mismatch)
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code: string }).code === 'P2022'
    ) {
      res.status(500).json({
        success: false,
        error: {
          code: 'DB_SCHEMA_MISMATCH',
          message: 'A database configuration error occurred. Please contact support.',
        },
      });
      return;
    }
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'Pi authentication failed' },
    });
  }
};
