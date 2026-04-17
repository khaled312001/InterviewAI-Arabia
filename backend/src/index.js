import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import morgan from 'morgan';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import { generalLimiter } from './middleware/rateLimit.js';
import { notFound, errorHandler } from './middleware/errorHandler.js';
import './utils/asyncHandler.js'; // registers BigInt.toJSON

import authRoutes from './routes/auth.js';
import userRoutes from './routes/user.js';
import categoryRoutes from './routes/categories.js';
import sessionRoutes from './routes/sessions.js';
import subscriptionRoutes from './routes/subscriptions.js';
import adminRoutes from './routes/admin.js';
import { startCronJobs } from './services/cron.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || env.corsOrigins.includes(origin) || env.corsOrigins.includes('*')) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
}));
app.use(compression());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(morgan(env.isProd ? 'combined' : 'dev', {
  stream: { write: (msg) => logger.http ? logger.http(msg.trim()) : logger.info(msg.trim()) },
}));

app.use('/api', generalLimiter);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'interviewai-arabia', time: new Date().toISOString() });
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/sessions', sessionRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/admin', adminRoutes);

// Serve built admin SPA (copied here by deploy.sh)
const adminDist = path.resolve(__dirname, '..', 'public', 'admin');
app.use('/admin', express.static(adminDist));
app.get('/admin/*', (_req, res) => {
  res.sendFile(path.join(adminDist, 'index.html'), (err) => {
    if (err) res.status(404).send('Admin dashboard not built yet. Run scripts/deploy.sh.');
  });
});

app.get('/', (_req, res) => {
  res.json({
    app: 'InterviewAI Arabia',
    company: 'شركة برمجلي',
    website: 'https://barmagly.tech',
    admin: '/admin',
    health: '/api/health',
  });
});

app.use(notFound);
app.use(errorHandler);

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
