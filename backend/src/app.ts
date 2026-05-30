import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import authRouter from './modules/auth/auth.route';
import { uploadRouter } from './modules/upload/upload.routes';
import { jobRouter } from './modules/jobs/job.routes';
import { cropRouter } from './modules/crop/crop.routes';
import { finalizeRouter } from './modules/finalize/finalize.routes';
import { collectionRouter } from './modules/collections/collection.routes';
import { errorHandler } from './common/middlewares/errorHandler';
import { apiLimiter } from './common/middlewares/rateLimit';

export function createApp() {
  const app = express();

  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({
    origin: process.env.FRONTEND_URL ?? 'http://localhost:3000',
    credentials: true,
  }));
  // SECURITY (#16): bound JSON payloads. Uploads go through Multer (20 MB), not here.
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  app.get('/health', (_req, res) => {
    res.json({ status: 'OK' });
  });

  // Bridge OAuth callback to frontend. Token goes in the fragment (#7), not the
  // query string, so it never lands in the frontend's server/access logs.
  app.get('/auth/callback', (req, res) => {
    const token = req.query['token'];
    const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000';
    if (!token || typeof token !== 'string') {
      res.redirect(`${frontendUrl}/login?error=missing_token`);
      return;
    }
    res.redirect(`${frontendUrl}/auth/callback#token=${encodeURIComponent(token)}`);
  });

  // SECURITY (#5): loose global backstop on the whole API surface.
  app.use('/api', apiLimiter);

  app.use('/api/auth', authRouter);
  app.use('/api', uploadRouter);
  app.use('/api', jobRouter);
  app.use('/api', cropRouter);
  app.use('/api', finalizeRouter);
  app.use('/api', collectionRouter);

  app.use(errorHandler);

  return app;
}
