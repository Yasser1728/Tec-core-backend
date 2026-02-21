import jwt, { SignOptions } from 'jsonwebtoken';
import type { StringValue } from 'ms';

const JWT_SECRET = process.env.JWT_SECRET!;
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET!;
const JWT_EXPIRES_IN = (process.env.JWT_EXPIRES_IN || '1h') as StringValue;
const JWT_REFRESH_EXPIRES_IN = (process.env.JWT_REFRESH_EXPIRES_IN || '7d') as StringValue;

interface TokenPayload {
  userId: string;
}

// Generate access and refresh tokens
export const generateTokens = (userId: string): { accessToken: string; refreshToken: string } => {
  const accessOptions: SignOptions = {
    expiresIn: JWT_EXPIRES_IN,
  };

  const refreshOptions: SignOptions = {
    expiresIn: JWT_REFRESH_EXPIRES_IN,
  };

  const accessToken = jwt.sign({ userId }, JWT_SECRET, accessOptions);
  const refreshToken = jwt.sign({ userId }, JWT_REFRESH_SECRET, refreshOptions);

  return { accessToken, refreshToken };
};

// Verify access token
export const verifyAccessToken = (token: string): TokenPayload | null => {
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as TokenPayload;
    return decoded;
  } catch (_error) {
    return null;
  }
};

// Verify refresh token
export const verifyRefreshToken = (token: string): TokenPayload | null => {
  try {
    const decoded = jwt.verify(token, JWT_REFRESH_SECRET) as TokenPayload;
    return decoded;
  } catch (_error) {
    return null;
  }
};