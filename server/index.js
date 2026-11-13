import pino from 'pino';
import { createClient } from '@supabase/supabase-js';
import { loadConfig } from './config.js';
import { createApp } from './app.js';
import { createModels } from './models.js';
import { createRetriever } from './retrieval.js';
import { createReranker } from './rerank.js';
import { createGenerator } from './generate.js';
import { createPipeline } from './pipeline.js';

let config;
try {
  config = loadConfig();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

const logger = pino({ level: config.LOG_LEVEL });
const models = createModels(config);
const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
});

const pipeline = createPipeline({
  retriever: createRetriever({ models, supabase, config }),
  reranker: createReranker({ models }),
  generator: createGenerator({ models }),
  config,
  logger,
});

const checkReady = async () => {
  const { error } = await supabase.from('movies').select('id').limit(1);
  if (error) throw error;
};

const server = createApp({ pipeline, config, logger, checkReady }).listen(config.PORT, () =>
  logger.info(`API listening on http://localhost:${config.PORT}`),
);

// Graceful shutdown: stop accepting connections, let in-flight requests finish.
function shutdown(signal) {
  logger.info({ signal }, 'shutting down');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (err) => logger.error({ err }, 'unhandled rejection'));
