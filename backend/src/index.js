// Local / Hostinger entry point. Boots the long-running Express server and
// starts the in-process cron scheduler. Not used on Vercel — see api/index.js.

import { createApp } from './app.js';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import { startCronJobs } from './services/cron.js';

const app = createApp();
const port = env.PORT;

app.listen(port, () => {
  logger.info(`InterviewAI Arabia backend listening on :${port} (${env.NODE_ENV})`);
  startCronJobs();
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', { reason });
});
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { message: err.message, stack: err.stack });
});

