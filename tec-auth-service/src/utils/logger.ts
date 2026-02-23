/**
 * Log context for structured logging.
 * Attach userId to any log line that is scoped to a specific user.
 */
export interface LogContext {
  /** ID of the authenticated user performing the action, if available */
  userId?: string;
  [key: string]: unknown;
}

export const logInfo = (message: string, meta?: LogContext): void => {
  console.log(JSON.stringify({ level: 'info', message, ...meta, timestamp: new Date().toISOString() }));
};

export const logWarn = (message: string, meta?: LogContext): void => {
  console.warn(JSON.stringify({ level: 'warn', message, ...meta, timestamp: new Date().toISOString() }));
};

export const logError = (message: string, meta?: LogContext): void => {
  console.error(JSON.stringify({ level: 'error', message, ...meta, timestamp: new Date().toISOString() }));
};

// Audit log — records security-sensitive events with user context
export const logAudit = (action: string, context: LogContext): void => {
  console.log(JSON.stringify({ level: 'audit', action, ...context, timestamp: new Date().toISOString() }));
};
