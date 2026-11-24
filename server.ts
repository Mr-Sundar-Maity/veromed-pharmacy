import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import { DATABASE_PATH, initSchema, queuePersistentStateSave, seedDatabase } from './server/db';
import { createApiRouter } from './server/routes';
import { runBackgroundScheduler } from './server/scheduler';

async function startServer() {
  console.log(`VeroMed database: ${DATABASE_PATH}`);
  if (
    process.env.NODE_ENV === 'production' &&
    !process.env.VEROMED_DATA_DIR &&
    !process.env.DATABASE_URL
  ) {
    console.warn(
      'WARNING: VEROMED_DATA_DIR is not configured. Production data may be lost on an ephemeral filesystem.'
    );
  }
  initSchema();
  seedDatabase();
  await queuePersistentStateSave();
  runBackgroundScheduler();

  // Periodic idempotent reminder & expiry scan every 60 seconds
  setInterval(() => {
    try {
      runBackgroundScheduler();
    } catch (err) {
      console.error('Background scheduler tick failed:', err);
    }
  }, 60_000);

  const app = express();
  app.use(express.json({ limit: '4mb' }));

  // Persist every successful mutation to Neon while retaining SQLite compatibility.
  app.use((req, res, next) => {
    res.on('finish', () => {
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && res.statusCode < 400) {
        void queuePersistentStateSave().catch((err) => {
          console.error('Neon persistence checkpoint failed:', err);
        });
      }
    });
    next();
  });

  // CORS configuration for Firebase Hosting
  const allowedOrigins = [
    'https://veromedphm.web.app',
    'http://localhost:5173'
  ];

  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    next();
  });

  // Basic security headers
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  app.use('/api/v1', createApiRouter());

  // Unmatched /api/v1/* endpoints return structured JSON 404 instead of SPA HTML
  app.use('/api/v1', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found.' });
  });

  // Structured API error handler (multer/validation/internal)
  app.use('/api/v1', (err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(400).json({ error: err.message || 'Bad API request.' });
  });

  const isProd = process.env.NODE_ENV === 'production';
  const distDir = path.resolve(process.cwd(), 'dist');

  if (!isProd || !fs.existsSync(distDir)) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const port = Number(process.env.PORT || 3000);
  const server = app.listen(port, '0.0.0.0', () => {
    console.log(`VeroMed server running on http://0.0.0.0:${port}`);
  });

  const persistenceTimer = setInterval(() => {
    void queuePersistentStateSave().catch((err) => {
      console.error('Scheduled Neon persistence checkpoint failed:', err);
    });
  }, 30_000);

  const shutdown = async (signal: string) => {
    console.log(`${signal} received; saving persistent state before shutdown.`);
    clearInterval(persistenceTimer);
    try {
      await queuePersistentStateSave();
    } catch (err) {
      console.error('Final Neon persistence checkpoint failed:', err);
    }
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));
}

startServer().catch((err) => {
  console.error('Failed to start VeroMed server:', err);
  process.exit(1);
});
