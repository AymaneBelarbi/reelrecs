import { traceable } from 'langsmith/traceable';
import { LRUCache, buildKeywordQuery } from './lib/utils.js';

/**
 * Hybrid retrieval: dense (pgvector) + sparse (Postgres full-text), fused with
 * Reciprocal Rank Fusion inside the `hybrid_search` SQL function.
 */
export function createRetriever({ models, supabase, config, cache = new LRUCache(500) }) {
  async function embed(text) {
    const key = `${config.EMBEDDING_MODEL}:${text}`;
    const hit = cache.get(key);
    if (hit) return hit;
    const vector = await models.embeddings.embedQuery(text);
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

  return {
    embed: traceable(embed, {
      name: 'embed',
      run_type: 'embedding',
      processOutputs: ({ outputs }) => ({ dimensions: outputs.length }),
    }),
    search: traceable(search, {
      name: 'hybrid_search',
      run_type: 'retriever',
      processInputs: ({ args: [query, embedding, overrides] }) => ({ query, dense: Boolean(embedding), overrides }),
      processOutputs: ({ outputs }) => ({
        documents: outputs.map((r) => ({
          type: 'Document',
          page_content: r.content,
          metadata: { id: r.id, title: r.title, year: r.year, score: r.score },
        })),
      }),
    }),
  };
}
