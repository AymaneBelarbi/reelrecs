import { parseCitations, timed } from './lib/utils.js';

export const NO_MATCH_REPLY =
  "I couldn't find a good match in my movie database. Try describing a genre, mood, plot or director.";

/**
 * The RAG pipeline: rewrite -> embed -> hybrid search -> rerank -> relevance gate -> grounded answer.
 * Every optional stage degrades gracefully (recorded in `meta.degraded`) instead of failing the request.
 * Dependencies are injected so the whole flow is unit-testable without network access.
 */
export function createPipeline({ retriever, reranker, generator, config, logger }) {
  return async function run({ message, history = [] }) {
    const timings = {};
    const degraded = [];

    // 1. Condense follow-up questions into a standalone query.
    let query = message;
    if (config.REWRITE_ENABLED && history.length > 0) {
      try {
        query = await timed(timings, 'rewrite', () => generator.rewrite(message, history));
      } catch (err) {
        degraded.push('rewrite');
        logger?.warn({ err: err.message }, 'query rewrite failed; using original message');
      }
    }

    // 2. Embed. If this fails we still serve keyword results.
    let embedding = null;
    try {
      embedding = await timed(timings, 'embed', () => retriever.embed(query));
    } catch (err) {
      degraded.push('embedding');
      logger?.warn({ err: err.message }, 'embedding failed; falling back to keyword-only search');
    }

    // 3. Hybrid retrieval (dense + sparse, RRF-fused). A failure here is fatal.
    const candidates = await timed(timings, 'search', () => retriever.search(query, embedding));

    // 4. Rerank for precision, then gate on relevance so we never answer from irrelevant context.
    let ranked = candidates;
    if (config.RERANK_ENABLED && candidates.length > 0) {
      try {
        const scored = await timed(timings, 'rerank', () => reranker(query, candidates));
        ranked = scored.filter((c) => c.rerankScore >= config.RERANK_MIN_SCORE);
      } catch (err) {
        degraded.push('rerank');
        logger?.warn({ err: err.message }, 'rerank failed; using fused order');
      }
    }
    const context = ranked.slice(0, config.CONTEXT_SIZE);

    const meta = { query, degraded, timingsMs: timings, candidates: candidates.length };
    if (context.length === 0) return { reply: NO_MATCH_REPLY, sources: [], meta };

    // 5. Grounded generation with citations.
    const reply = await timed(timings, 'generate', () =>
      generator.answer({ message, history, sources: context }),
    );

    const cited = parseCitations(reply).filter((n) => n >= 1 && n <= context.length);
    const used = cited.length > 0 ? cited.map((n) => context[n - 1]) : context;
    const sources = used.map((s) => ({
      id: s.id,
      title: s.title,
      year: s.year,
      score: s.rerankScore ?? s.score,
    }));

    return { reply, sources, meta };
  };
}
