import { LRUCache, buildKeywordQuery } from './lib/utils.js';

/**
 * Hybrid retrieval: dense (pgvector) + sparse (Postgres full-text), fused with
 * Reciprocal Rank Fusion inside the `hybrid_search` SQL function.
 */
export function createRetriever({ openai, supabase, config, cache = new LRUCache(500) }) {
  async function embed(text) {
    const key = `${config.EMBEDDING_MODEL}:${text}`;
    const hit = cache.get(key);
    if (hit) return hit;
    const res = await openai.embeddings.create({ model: config.EMBEDDING_MODEL, input: text });
    const vector = res.data[0].embedding;
    cache.set(key, vector);
    return vector;
  }

  /** `embedding` may be null: the SQL function then falls back to keyword-only search. */
  async function search(query, embedding, overrides = {}) {
    const { data, error } = await supabase
      .rpc('hybrid_search', {
        keyword_query: buildKeywordQuery(query),
        query_embedding: embedding,
        match_count: overrides.matchCount ?? config.CANDIDATES,
        semantic_weight: overrides.semanticWeight ?? config.SEMANTIC_WEIGHT,
        keyword_weight: overrides.keywordWeight ?? config.KEYWORD_WEIGHT,
        rrf_k: config.RRF_K,
      })
      .abortSignal(AbortSignal.timeout(config.DB_TIMEOUT_MS));
    if (error) throw new Error(`hybrid_search failed: ${error.message}`);
    return data ?? [];
  }

  return { embed, search };
}
