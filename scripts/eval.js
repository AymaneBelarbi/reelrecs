// Retrieval evaluation: compares dense-only, keyword-only, hybrid and hybrid+rerank
// on data/eval.json. Reports hit@1, hit@3 and MRR. Usage: npm run eval
import { readFile } from 'node:fs/promises';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';
import { loadConfig } from '../server/config.js';
import { createRetriever } from '../server/retrieval.js';
import { createReranker } from '../server/rerank.js';

const config = loadConfig();
const openai = new OpenAI({ apiKey: config.OPENAI_API_KEY, maxRetries: config.OPENAI_MAX_RETRIES });
const supabase = createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const retriever = createRetriever({ openai, supabase, config });
const rerank = createReranker({ openai, config });

const cases = JSON.parse(await readFile(new URL('../data/eval.json', import.meta.url), 'utf8'));

const modes = {
  'dense only': (q, e) => retriever.search(q, e, { keywordWeight: 0 }),
  'keyword only': (q) => retriever.search(q, null),
  hybrid: (q, e) => retriever.search(q, e),
  'hybrid + rerank': async (q, e) => rerank(q, await retriever.search(q, e)),
};

const rows = [];
for (const [name, fn] of Object.entries(modes)) {
  let hit1 = 0, hit3 = 0, mrr = 0;
  for (const c of cases) {
    const embedding = await retriever.embed(c.query);
    const results = await fn(c.query, embedding);
    const rank = results.findIndex((r) => c.expected.includes(r.title)) + 1; // 0 = not found
    if (rank === 1) hit1++;
    if (rank >= 1 && rank <= 3) hit3++;
    if (rank >= 1) mrr += 1 / rank;
  }
  const n = cases.length;
  rows.push({ mode: name, 'hit@1': (hit1 / n).toFixed(2), 'hit@3': (hit3 / n).toFixed(2), MRR: (mrr / n).toFixed(2) });
}
console.table(rows);
