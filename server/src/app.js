import express from 'express';
import cors from 'cors';
import env from './config/env.js';
import routes from './routes/index.js';
import { notFoundHandler, errorHandler } from './middleware/errorHandler.js';

const app = express();

app.set('trust proxy', 1);
// Content-Disposition is exposed so the browser can read the export
// filename from the cross-origin CSV download (Batch 6).
const corsOrigin = (origin, callback) => {
  if (!origin) return callback(null, true);
  if (
    origin === env.clientOrigin ||
    origin.endsWith('.vercel.app') ||
    origin.includes('localhost') ||
    origin.includes('127.0.0.1')
  ) {
    return callback(null, origin);
  }
  callback(null, origin);
};

app.use(cors({ origin: corsOrigin, credentials: true, exposedHeaders: ['Content-Disposition'] }));

// JSON body limit: 1 MB everywhere, except document uploads which carry a
// base64-encoded file of up to 5 MB (~6.7 MB once encoded).
app.use((req, res, next) => {
  const limit = req.path.startsWith('/api/documents') ? '8mb' : '1mb';
  express.json({ limit })(req, res, next);
});

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    if (req.path.startsWith('/api')) {
      console.log(`${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - start}ms)`);
    }
  });
  next();
});

app.use('/api', routes);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
