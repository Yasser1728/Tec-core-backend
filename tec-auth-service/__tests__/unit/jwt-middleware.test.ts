import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';

// Set up env before importing the middleware
process.env.JWT_SECRET = 'test-jwt-secret-for-unit-tests';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-for-unit-tests';

import { jwtMiddleware } from '../../src/middlewares/jwt.middleware';

/** Minimal mock helpers */
const mockRes = () => {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
};

const mockNext: NextFunction = jest.fn();

describe('jwtMiddleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 401 when Authorization header is missing', () => {
    const req = { headers: {} } as Request;
    const res = mockRes();

    jwtMiddleware(req, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false })
    );
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('returns 401 when Authorization header has wrong scheme', () => {
    const req = { headers: { authorization: 'Basic abc123' } } as Request;
    const res = mockRes();

    jwtMiddleware(req, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('returns 401 when token is invalid', () => {
    const req = { headers: { authorization: 'Bearer not-a-valid-jwt' } } as Request;
    const res = mockRes();

    jwtMiddleware(req, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('returns 401 when token is signed with wrong secret', () => {
    const badToken = jwt.sign({ userId: 'user-1' }, 'wrong-secret', { expiresIn: '1h' });
    const req = { headers: { authorization: `Bearer ${badToken}` } } as Request;
    const res = mockRes();

    jwtMiddleware(req, res, mockNext);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('calls next() and attaches userId for a valid token', () => {
    const validToken = jwt.sign({ userId: 'user-1' }, process.env.JWT_SECRET!, { expiresIn: '1h' });
    const req = { headers: { authorization: `Bearer ${validToken}` } } as Request;
    const res = mockRes();

    jwtMiddleware(req, res, mockNext);

    expect(mockNext).toHaveBeenCalled();
    expect((req as any).userId).toBe('user-1');
  });
});
