export const logInfo = (message: string, meta?: Record<string, unknown>): void => {
  console.log(JSON.stringify({ level: 'info', message, ...meta, timestamp: new Date().toISOString() }));
};

export const logWarn = (message: string, meta?: Record<string, unknown>): void => {
  console.warn(JSON.stringify({ level: 'warn', message, ...meta, timestamp: new Date().toISOString() }));
};

export const logError = (message: string, meta?: Record<string, unknown>): void => {
  console.error(JSON.stringify({ level: 'error', message, ...meta, timestamp: new Date().toISOString() }));
};
