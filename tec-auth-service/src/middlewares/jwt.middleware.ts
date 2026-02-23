import { Request, Response, NextFunction } from 'express';

// TODO: implement JWT verification middleware
export const jwtMiddleware = (_req: Request, _res: Response, next: NextFunction): void => {
  next();
};
