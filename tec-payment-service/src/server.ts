import dotenv from 'dotenv';
import app from './app';
import { logInfo } from './utils/logger';

dotenv.config();

const PORT = process.env.PORT || 5003;

app.listen(PORT, () => {
  logInfo(`💳 Payment Service running on port ${PORT}`);
});

export default app;
