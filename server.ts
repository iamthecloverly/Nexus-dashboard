import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { createServer as createViteServer } from 'vite';
import path from 'path';

import { attachCsrf } from './server/middleware/csrf.ts';
import { isProduction, SESSION_SECRET } from './server/config.ts';

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

app.use(helmet({ contentSecurityPolicy: false })); // CSP disabled — Vite injects inline scripts in dev
app.use(cookieParser(SESSION_SECRET));
app.use(express.json({ limit: '50kb' }));

attachCsrf(app);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api/session', sessionRouter);
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
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
