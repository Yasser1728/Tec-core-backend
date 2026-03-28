import { Request, Response, NextFunction } from 'express';
import { requestIdMiddleware } from '../../src/middleware/request-id';

const mockRes = () => {
  const res: Partial<Response> = {};
  res.setHeader = jest.fn();
  return res as Response;
};

describe('requestIdMiddleware', () => {
  const next = jest.fn() as NextFunction;

  beforeEach(() => jest.clearAllMocks());

  it('generates a UUID when no x-request-id header provided', () => {
    const req = { headers: {} } as Request;
    requestIdMiddleware(req, mockRes(), next);
    expect(req.headers['x-request-id']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(next).toHaveBeenCalled();
  });

  it('preserves existing x-request-id header', () => {
    const req = { headers: { 'x-request-id': 'my-request-id' } } as any;
    requestIdMiddleware(req, mockRes(), next);
    expect(req.headers['x-request-id']).toBe('my-request-id');
  });

  it('echoes x-request-id back as response header', () => {
    const req = { headers: { 'x-request-id': 'echo-id' } } as any;
    const res = mockRes();
    requestIdMiddleware(req, res, next);
    expect(res.setHeader).toHaveBeenCalledWith('x-request-id', 'echo-id');
  });

  it('generates different IDs for consecutive requests', () => {
    const req1 = { headers: {} } as Request;
    const req2 = { headers: {} } as Request;
    requestIdMiddleware(req1, mockRes(), next);
    requestIdMiddleware(req2, mockRes(), next);
    expect(req1.headers['x-request-id']).not.toBe(req2.headers['x-request-id']);
  });

  it('calls next()', () => {
    const req = { headers: {} } as Request;
    requestIdMiddleware(req, mockRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
