import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { createServer as createViteServer } from 'vite';
import path from 'path';

import { attachCsrf } from './server/middleware/csrf';
import { isProduction, SESSION_SECRET } from './server/config';

import { authRouter } from './server/routes/auth';
import { calendarRouter } from './server/routes/calendar';
import { gmailRouter } from './server/routes/gmail';
import { githubRouter } from './server/routes/github';
import { discordRouter } from './server/routes/discord';
import { aiRouter } from './server/routes/ai';
import { systemRouter } from './server/routes/system';

const app = express();
const PORT = 3000;

app.use(helmet({ contentSecurityPolicy: false })); // CSP disabled — Vite injects inline scripts in dev
app.use(cookieParser(SESSION_SECRET));
app.use(express.json({ limit: '50kb' }));

attachCsrf(app);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api/auth', authRouter);
app.use('/api/calendar', calendarRouter);
app.use('/api/gmail', gmailRouter);
app.use('/api/github', githubRouter);
app.use('/api/discord', discordRouter);
app.use('/api/ai', aiRouter);
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
