import { z } from 'zod';

const bool = (def) => z.enum(['true', 'false']).default(def).transform((v) => v === 'true');

const schema = z.object({
  OPENAI_API_KEY: z.string().min(1),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_KEY: z.string().min(1),

  PORT: z.coerce.number().int().default(3001),
  NODE_ENV: z.string().default('development'),
  LOG_LEVEL: z.string().default('info'),
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  RATE_LIMIT_PER_MIN: z.coerce.number().int().min(1).default(20),

  EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),
  CHAT_MODEL: z.string().default('gpt-4o-mini'),
  RERANK_MODEL: z.string().optional(),

  // Retrieval pipeline
  CANDIDATES: z.coerce.number().int().min(1).max(50).default(20), // fetched by hybrid search
  CONTEXT_SIZE: z.coerce.number().int().min(1).max(10).default(4), // passed to the LLM
  SEMANTIC_WEIGHT: z.coerce.number().min(0).default(1),
  KEYWORD_WEIGHT: z.coerce.number().min(0).default(1),
  RRF_K: z.coerce.number().int().min(1).default(50),
  RERANK_ENABLED: bool('true'),
  RERANK_MIN_SCORE: z.coerce.number().min(0).max(10).default(4),
  REWRITE_ENABLED: bool('true'),

  // Reliability
  OPENAI_TIMEOUT_MS: z.coerce.number().int().default(20000),
  OPENAI_MAX_RETRIES: z.coerce.number().int().default(3),
  DB_TIMEOUT_MS: z.coerce.number().int().default(10000),
});

export function loadConfig(env = process.env) {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration (${problems}). See .env.example.`);
  }
  const config = parsed.data;
  return { ...config, RERANK_MODEL: config.RERANK_MODEL ?? config.CHAT_MODEL };
}
