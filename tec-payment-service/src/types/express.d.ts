import 'express-serve-static-core';

declare module 'express-serve-static-core' {
  interface Request {
    /** Verified user identity attached by jwt.middleware */
    user?: {
      id: string;
    };
    /** Convenience shorthand also set by jwt.middleware */
    userId?: string;
  }
}
