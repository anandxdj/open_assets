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
import { usageRouter } from './modules/usage/index.usage';
import { enhanceRouter } from './modules/enhance/enhance.routes';
import {
  anibuddyRouter,
  ANIBUDDY_ANNOTATE_BODY_LIMIT,
  ANIBUDDY_ANNOTATE_BODY_MOUNT,
  ANIBUDDY_CLIP_BODY_LIMIT,
  ANIBUDDY_CLIP_BODY_MOUNT,
} from './modules/anibuddy/index.anibuddy';
import { errorHandler } from './common/middlewares/errorHandler';
import { apiLimiter } from './common/middlewares/rateLimit';

export function createApp() {
  const app = express();

  app.set('trust proxy', 1);
  app.use(helmet());
  const allowedOrigins = [
    process.env.FRONTEND_URL,
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'https://openassets.anands.dev',
    'https://openasset.anands.dev'
  ].filter(Boolean) as string[];
  const extensionOrigins = (process.env.EXTENSION_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.use(cors({
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }
      const isDevelopment = process.env.NODE_ENV !== 'production';
      const isAllowed = allowedOrigins.includes(origin) ||
        extensionOrigins.includes(origin) ||
        (isDevelopment && (/^http:\/\/localhost:\d+$/.test(origin) || /^chrome-extension:\/\/[a-p]{32}$/.test(origin)));
      if (isAllowed) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
  }));
  // A single AniBuddy clip may carry 32 keyframes across 96 joints and 64 parts,
  // which does not fit the bound below. Mounted first on purpose: express.json
  // skips a request whose body has already been parsed, so the wider limit
  // applies to exactly this path and the global one still guards everything else.
  app.use(ANIBUDDY_CLIP_BODY_MOUNT, express.json({ limit: ANIBUDDY_CLIP_BODY_LIMIT }));
  // The internal annotate route carries a whole source sheet as base64 plus the
  // document its outlines are traced from. Mounted first for the same reason, and
  // reachable only with the service token — the route itself is what bounds who may
  // post a body this size.
  app.use(
    ANIBUDDY_ANNOTATE_BODY_MOUNT,
    express.json({ limit: ANIBUDDY_ANNOTATE_BODY_LIMIT }),
  );

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
    res.redirect(`${frontendUrl}/callback#token=${encodeURIComponent(token)}`);
  });

  // SECURITY (#5): loose global backstop on the whole API surface.
  app.use('/api', apiLimiter);

  app.use('/api/auth', authRouter);
  app.use('/api', uploadRouter);
  app.use('/api', jobRouter);
  app.use('/api', cropRouter);
  app.use('/api', finalizeRouter);
  app.use('/api', collectionRouter);
  app.use('/api', usageRouter);
  app.use('/api', enhanceRouter);
  app.use('/api', anibuddyRouter);

  app.use(errorHandler);

  return app;
}
