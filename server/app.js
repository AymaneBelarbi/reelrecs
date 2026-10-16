import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import pinoHttp from 'pino-http';
import { z } from 'zod';

const MAX_HISTORY_MESSAGES = 10;
const REQUEST_ID_PATTERN = /^[\w-]{1,64}$/;

const requestSchema = z.object({
  message: z.string().trim().min(1, 'Please enter a question.').max(500, 'Questions are limited to 500 characters.'),
  history: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(2000) }))
    .max(40)
    .default([])
    // Keep only the most recent turns instead of rejecting long conversations.
    .transform((history) => history.slice(-MAX_HISTORY_MESSAGES)),
});

export function createApp({ pipeline, config, logger, checkReady }) {
  const app = express();
  app.set('trust proxy', config.TRUST_PROXY);
  app.disable('x-powered-by');

  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const supplied = req.headers['x-request-id'];
        const id = REQUEST_ID_PATTERN.test(supplied ?? '') ? supplied : randomUUID();
        res.setHeader('X-Request-Id', id);
        return id;
      },
      autoLogging: { ignore: (req) => req.url === '/health' },
    }),
  );
  app.use(helmet());
  // Sized for the largest valid payload (40 history items x 2000 chars) with room for multi-byte text.
  app.use(express.json({ limit: '64kb' }));

  // Liveness: process is up. Readiness: dependencies (database) are reachable.
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  app.get('/ready', async (_req, res) => {
    try {
      await checkReady();
      res.json({ status: 'ready' });
    } catch (err) {
      res.status(503).json({ status: 'unavailable' });
    }
  });

  const limiter = rateLimit({
    windowMs: 60_000,
    limit: config.RATE_LIMIT_PER_MIN,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests. Please slow down.' },
  });

  app.post('/api/chat', limiter, async (req, res) => {
    const parsed = requestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0].message });
    }
    try {
      const result = await pipeline(parsed.data);
      req.log.info({ ...result.meta, sources: result.sources.length }, 'chat completed');
      res.json(result);
    } catch (err) {
      req.log.error({ err }, 'chat failed');
      res.status(503).json({ error: 'The assistant is temporarily unavailable. Please try again.' });
    }
  });

  // In production the same process serves the built frontend.
  if (config.NODE_ENV === 'production') {
    const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
    app.use(express.static(dist));
  }

  // Malformed JSON and other errors.
  app.use((err, req, res, _next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON.' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request too large.' });
    req.log?.error({ err }, 'unhandled error');
    res.status(500).json({ error: 'Internal server error.' });
  });

  return app;
}
