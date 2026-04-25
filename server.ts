import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import pinoHttp from 'pino-http';
import compression from 'compression';
import { createServer as createViteServer } from 'vite';
import path from 'path';

import { attachCsrf } from './server/middleware/csrf.ts';
import { isProduction, SESSION_SECRET } from './server/config.ts';
import { logger } from './server/lib/logger.ts';

import { authRouter } from './server/routes/auth.ts';
import { calendarRouter } from './server/routes/calendar.ts';
import { gmailRouter } from './server/routes/gmail.ts';
import { githubRouter } from './server/routes/github.ts';
import { discordRouter } from './server/routes/discord.ts';
import { aiRouter } from './server/routes/ai.ts';
import { systemRouter } from './server/routes/system.ts';
import { weatherRouter } from './server/routes/weather.ts';
import { sessionRouter } from './server/routes/session.ts';
import { requireDashboardAccess } from './server/middleware/requireDashboardAccess.ts';

const app = express();
const PORT = 3001;

// When self-hosting behind a reverse proxy, this ensures req.protocol reflects x-forwarded-proto.
app.set('trust proxy', 1);

// Pino HTTP logging middleware
app.use(pinoHttp({ logger }));

// Compression middleware - gzip/deflate responses
app.use(compression());

app.use(helmet({ contentSecurityPolicy: false })); // CSP disabled — Vite injects inline scripts in dev
app.use(cookieParser(SESSION_SECRET));
app.use(express.json({ limit: '50kb' }));

// Global rate limiter: 100 requests per 5 minutes per IP
const globalLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later' },
});
app.use('/api', globalLimiter);

// Stricter rate limiters for sensitive endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

const emailSendLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

const discordSendLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

attachCsrf(app);

app.get('/api/health', async (_req, res) => {
  const checks: Record<string, string> = {};
  let overallStatus: 'ok' | 'degraded' | 'error' = 'ok';

  // Check if environment variables are set
  checks.google_oauth = process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET ? 'ok' : 'error';
  checks.session = process.env.SESSION_SECRET ? 'ok' : 'error';
  checks.openai_api = process.env.OPENAI_API_KEY ? 'ok' : 'not_configured';
  checks.github_api = process.env.GITHUB_TOKEN ? 'ok' : 'not_configured';

  // Determine overall status
  if (checks.google_oauth === 'error' || checks.session === 'error') {
    overallStatus = 'error';
  } else if (Object.values(checks).includes('error')) {
    overallStatus = 'degraded';
  }

  const statusCode = overallStatus === 'error' ? 503 : 200;
  res.status(statusCode).json({ status: overallStatus, checks });
});

app.use('/api/session', authLimiter, sessionRouter);
app.use('/api/auth', authRouter);
app.use('/api/calendar', requireDashboardAccess, calendarRouter);
app.use('/api/gmail', requireDashboardAccess, gmailRouter);
app.use('/api/github', requireDashboardAccess, githubRouter);
app.use('/api/discord', requireDashboardAccess, discordRouter);
app.use('/api/ai', requireDashboardAccess, aiRouter);
app.use('/api', weatherRouter);
app.use('/api', systemRouter);

async function startServer() {
  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Bind to localhost in dev (prevents LAN exposure); 0.0.0.0 in production for container/deploy
  const host = isProduction ? '0.0.0.0' : '127.0.0.1';
  app.listen(PORT, host, () => {
    logger.info(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
