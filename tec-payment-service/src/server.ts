import dotenv from 'dotenv';
import app from './app';
import { logInfo } from './utils/logger';
import { env } from './config/env';

dotenv.config();

const PORT = env.PORT;

app.listen(PORT, () => {
  logInfo(`💳 Payment Service running on port ${PORT}`);
});

export default app;
