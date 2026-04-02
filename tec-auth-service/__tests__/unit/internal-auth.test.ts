import { Request, Response, NextFunction } from 'express';
import { validateInternalKey } from '../../src/middleware/internal-auth';

const mockRes = () => {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json   = jest.fn().mockReturnValue(res);
  return res as Response;
};

describe('validateInternalKey', () => {
  const next = jest.fn() as NextFunction;

  beforeEach(() => jest.clearAllMocks());

  it('passes through when INTERNAL_SECRET is not configured (non-production)', () => {
    delete process.env.INTERNAL_SECRET;
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      const req = { headers: {} } as Request;
      validateInternalKey(req, mockRes(), next);
      expect(next).toHaveBeenCalled();
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  it('throws when INTERNAL_SECRET is not configured in production', () => {
    delete process.env.INTERNAL_SECRET;
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const req = { headers: {} } as Request;
      expect(() => validateInternalKey(req, mockRes(), next)).toThrow(
        'INTERNAL_SECRET must be configured in production',
      );
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  it('returns 403 when x-internal-key header is missing', () => {
    process.env.INTERNAL_SECRET = 'secret123';
    const req = { headers: {} } as Request;
    const res = mockRes();
    validateInternalKey(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 403 when x-internal-key is wrong', () => {
    process.env.INTERNAL_SECRET = 'secret123';
    const req = { headers: { 'x-internal-key': 'wrong-key' } } as any;
    const res = mockRes();
    validateInternalKey(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next() when x-internal-key matches', () => {
    process.env.INTERNAL_SECRET = 'secret123';
    const req = { headers: { 'x-internal-key': 'secret123' } } as any;
    validateInternalKey(req, mockRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it('returns 403 when key length differs', () => {
    process.env.INTERNAL_SECRET = 'secret123';
    const req = { headers: { 'x-internal-key': 'short' } } as any;
    const res = mockRes();
    validateInternalKey(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
