import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import authRouter from './modules/auth/auth.route';
import { accountRouter } from './modules/account/account.routes';
import { uploadRouter } from './modules/upload/upload.routes';
import { jobRouter } from './modules/jobs/job.routes';
import { cropRouter } from './modules/crop/crop.routes';
import { finalizeRouter } from './modules/finalize/finalize.routes';
import { collectionRouter } from './modules/collections/collection.routes';
import { usageRouter } from './modules/usage/usage.routes';
import { enhanceRouter } from './modules/enhance/enhance.routes';
import mongoose from 'mongoose';
import { errorHandler } from './common/middlewares/errorHandler';
import { apiLimiter } from './common/middlewares/rateLimit';
import { redis } from './common/config/redis';
import { getConfig } from './common/config/env';
import { createCorsOptions } from './common/config/cors';
import { createHealthHandler } from './common/health';

export interface AppOptions {
  /** True once shutdown has started, so /health answers 503 and load balancers drain this instance. */
  isShuttingDown?: () => boolean;
}

export function createApp(options: AppOptions = {}) {
  const app = express();

  app.set('trust proxy', 1);
  app.use(helmet());
  // Allowed origins come from FRONTEND_URL, CORS_ORIGINS and EXTENSION_ORIGINS (see common/config/env.ts).
  app.use(cors(createCorsOptions(getConfig())));
  // SECURITY (#16): bound JSON payloads. Uploads go through Multer (20 MB), not here.
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  // Outside /api on purpose: not rate limited, no auth, used by Docker and load balancers.
  app.get(
    '/health',
    createHealthHandler({
      isShuttingDown: options.isShuttingDown,
      checks: [
        {
          name: 'mongo',
          run: async () => {
            const connection = mongoose.connection;
            if (connection.readyState !== 1 || !connection.db) throw new Error('not connected');
            await connection.db.admin().ping();
          },
        },
        {
          name: 'redis',
          run: async () => {
            if (redis.status !== 'ready') throw new Error(`status is ${redis.status}`);
            await redis.ping();
          },
        },
      ],
    }),
  );

  // Bridge OAuth callback to frontend. Token goes in the fragment (#7), not the
  // query string, so it never lands in the frontend's server/access logs.
  app.get('/auth/callback', (req, res) => {
    const token = req.query['token'];
    const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';
    if (!token || typeof token !== 'string') {
      res.redirect(`${frontendUrl}/login?error=missing_token`);
      return;
    }
    res.redirect(`${frontendUrl}/callback#token=${encodeURIComponent(token)}`);
  });

  // SECURITY (#5): loose global backstop on the whole API surface.
  app.use('/api', apiLimiter);

  app.use('/api/auth', authRouter);
  app.use('/api/account', accountRouter);
  app.use('/api', uploadRouter);
  app.use('/api', jobRouter);
  app.use('/api', cropRouter);
  app.use('/api', finalizeRouter);
  app.use('/api', collectionRouter);
  app.use('/api', usageRouter);
  app.use('/api', enhanceRouter);

  app.use(errorHandler);

  return app;
}
