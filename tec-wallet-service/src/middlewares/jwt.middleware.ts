import { Request, Response, NextFunction } from 'express';

// TODO: Implement JWT verification middleware
// - Extract Bearer token from Authorization header
// - Verify token using JWT_SECRET
// - Attach decoded user payload to req object
export const authenticate = (_req: Request, _res: Response, next: NextFunction): void => {
  next();
};
