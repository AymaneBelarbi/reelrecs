# ReelRecs 🎬

A movie-recommendation chatbot that demonstrates a **hybrid retrieval-augmented generation (RAG)** pipeline: dense vector search and keyword search are fused with Reciprocal Rank Fusion, reranked by an LLM, filtered by a relevance gate, and answered with cited sources. It is an engineering case study of retrieval design, graceful degradation and testing, not a finished product.

## Status

| Area | State |
| --- | --- |
| Unit and HTTP tests (17, offline, with injected fakes) | Passing |
| Production build, `npm audit` | Passing, 0 vulnerabilities |
| End-to-end run against live OpenAI + Supabase | **Not yet recorded in this repo** |
| `hybrid_search` SQL function | Reviewed, **not yet covered by an automated test** |
| Retrieval evaluation numbers | **Pending**: run `npm run eval` and add the table below |

### Evaluation results

_Not yet run. When you run `npm run eval`, record the date, models, corpus size and the output table here. With only 15 sample movies the retrieval stage returns nearly the whole corpus for any query, so those numbers show pipeline sanity, not retrieval quality. A larger corpus and out-of-domain queries are listed under limitations._

## Origin and provenance

- The project started from a Scrimba course exercise: a browser-only movie chatbot that embedded the question, queried Supabase for the nearest match and asked GPT to answer, with the API keys in client code.
- This repository replaces that design: server-side API, hybrid search with RRF in SQL, reranker, relevance gate, validated configuration, tests, Docker and CI. The page layout idea and brand colour come from the original starter.
- `data/movies.json` holds 15 short, hand-written descriptions of real films, written for this demo. It is not sourced from TMDB, IMDb or any other database, and the project is not affiliated with any of them.

## Pipeline

```mermaid
flowchart LR
  Q[User question] --> RW[Query rewrite<br/>resolve follow-ups]
  RW --> E[Embed query<br/>LRU cached]
  RW --> K[Keyword query<br/>sanitised OR tsquery]
  E --> D[Dense search<br/>pgvector HNSW]
  K --> S[Keyword search<br/>Postgres FTS + GIN]
  D --> F[Reciprocal Rank Fusion<br/>in SQL]
  S --> F
  F --> R[LLM reranker<br/>scores 0-10]
  R --> G{Relevance gate<br/>score >= threshold?}
  G -- no --> N[No-match reply<br/>no answer LLM call]
  G -- yes --> A[Grounded answer<br/>with [n] citations]
```

| Stage | What it does | Why |
| --- | --- | --- |
| Query rewrite | Turns "what about the second one?" into a standalone query | Follow-ups retrieve correctly |
| Hybrid search | Dense (meaning) plus full-text (exact names and terms), merged by RRF in one SQL function | Designed to cover both "mind-bending" and "Miyazaki" style queries |
| Rerank | An LLM scores each candidate 0-10 for relevance (listwise scoring, not a trained cross-encoder) | Better precision than raw similarity |
| Relevance gate | Drops results below `RERANK_MIN_SCORE`; no results means no answer-generation call | Avoids answering from irrelevant context |
| Grounded generation | Answers only from numbered sources, cites `[n]`, treats sources as data not instructions | Verifiable answers, some prompt-injection resistance |

### Reliability and security

- **Graceful degradation:** if query rewrite, embedding or rerank fails, the request still succeeds (keyword-only search, or fused order). Each degradation is reported in `meta.degraded`. The relevance gate depends on the reranker: with `RERANK_ENABLED=false`, or if reranking fails, results are not score-filtered.
- **Timeouts and retries:** OpenAI calls use retries with backoff and a timeout; the search call has an abort timeout.
- **Input handling:** zod validation, 64 kb body limit, conversation history trimmed to the last 10 messages, per-IP rate limiting, `helmet` headers, request IDs validated before logging, keyword input reduced to `[a-z0-9]` tokens so it cannot inject tsquery operators.
- **Secrets:** API keys exist only on the server. The database table is closed to anonymous clients (RLS on, grants revoked); the server uses the service-role key.
- **Operability:** structured JSON logs with per-stage timings, `/health` and `/ready`, graceful shutdown, Docker image with healthcheck.

## Known limitations

- Tiny sample corpus (15 films); no evaluation numbers recorded yet.
- The keyword leg uses an English, ASCII-only tokenizer and the English full-text config, so French accents and Arabic script are not handled well by keyword search (dense search and the LLM are multilingual). The answer language is not pinned.
- The in-memory rate limiter is per instance and per IP; there is no spend cap, authentication or response streaming.
- Client-supplied chat history is passed to the model as-is, so a malicious client can forge earlier assistant turns.
- Server logs include request metadata and the rewritten query text; there is no redaction or retention policy yet.

## Data and privacy

- The app stores no conversations and sets no cookies; chat history lives in the browser tab only.
- Each question is sent to the configured AI provider (OpenAI by default) to produce embeddings and answers. If you deploy this for others, choose an EU region for Supabase, review the provider's data-processing terms, and update this section and the logging behaviour to match.
- The interface tells users they are talking to an AI.
- No third-party fonts or CDNs are loaded by the frontend.

## Accessibility

Semantic form controls with labels, a live-region conversation log, visible keyboard focus, text contrast above 4.5:1, reduced-motion support and automatic text direction for right-to-left messages. A formal audit (axe or Lighthouse) has not been recorded yet.

## Tech stack

Vanilla JS + Vite · Node 22 + Express · OpenAI (embeddings, chat) · Supabase Postgres with pgvector and full-text search · pino · zod · Docker · GitHub Actions

## Getting started

Requires Node 22, an OpenAI API key and a free Supabase project.

```bash
npm install
cp .env.example .env      # fill in OPENAI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY
```

1. Paste [`supabase/schema.sql`](supabase/schema.sql) into the Supabase SQL editor and run it.
2. Load the sample data (edit [`data/movies.json`](data/movies.json) to add your own; re-running updates rows by title and year):
   ```bash
   npm run seed
   ```
3. Start the app at http://localhost:5173:
   ```bash
   npm run dev
   ```

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Vite + API with reload |
| `npm test` | Offline unit and HTTP tests |
| `npm run eval` | Compare dense / keyword / hybrid / hybrid+rerank on `data/eval.json` (hit@1, hit@3, MRR) |
| `npm run build` then `node --env-file=.env server/index.js` | Production build served by the API process (set `NODE_ENV=production`) |
| `docker build -t reelrecs . && docker run --env-file .env -p 3001:3001 reelrecs` | Container |

## Configuration

Optional env vars are listed in `.env.example`. If you change `EMBEDDING_MODEL`, re-seed, and make sure its dimension matches the `vector(1536)` column. The reranker uses structured JSON output, so `RERANK_MODEL` (default: `CHAT_MODEL`) must support it. Behind a reverse proxy, set `TRUST_PROXY=1` so rate limiting sees client IPs.

## Project structure

```
src/                 Chat UI
server/app.js        Express app: validation, rate limit, health, errors
server/pipeline.js   Orchestration + graceful degradation
server/retrieval.js  Embedding (cached) + hybrid_search RPC
server/rerank.js     LLM reranker (structured JSON output)
server/generate.js   Query rewrite + grounded answer prompt
server/config.js     Validated environment config
scripts/             seed.js, eval.js
supabase/schema.sql  Table, HNSW + GIN indexes, hybrid_search (RRF)
test/                node:test suites (pipeline, HTTP layer, helpers)
```

## Roadmap

Run and record the evaluation on a larger corpus with negative and multilingual queries · SQL integration test in CI · multilingual keyword search · log redaction and spend caps · streaming responses · optional hosted cross-encoder reranker.

## License

MIT, see [LICENSE](LICENSE).
