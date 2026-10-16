// Embeds every entry in data/movies.json and upserts it into Supabase.
// Idempotent: re-running updates existing rows (keyed on title + year) instead of duplicating.
// Usage: npm run seed
import { readFile } from 'node:fs/promises';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';

const { OPENAI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY, EMBEDDING_MODEL = 'text-embedding-3-small' } = process.env;
if (!OPENAI_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing env vars. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

const openai = new OpenAI({ apiKey: OPENAI_API_KEY, maxRetries: 3 });
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const movies = JSON.parse(await readFile(new URL('../data/movies.json', import.meta.url), 'utf8'));
const contents = movies.map((m) => `${m.title} (${m.year}). Genres: ${m.genres.join(', ')}. ${m.description}`);

console.log(`Embedding ${contents.length} movies with ${EMBEDDING_MODEL}...`);
const { data } = await openai.embeddings.create({ model: EMBEDDING_MODEL, input: contents });

const rows = movies.map((m, i) => ({
  title: m.title,
  year: m.year,
  genres: m.genres,
  content: contents[i],
  embedding: data[i].embedding,
}));

const { error } = await supabase.from('movies').upsert(rows, { onConflict: 'title,year' });
if (error) {
  console.error('Upsert failed:', error.message);
  process.exit(1);
}
console.log(`Upserted ${rows.length} rows into "movies".`);
