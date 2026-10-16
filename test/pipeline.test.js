import test from 'node:test';
import assert from 'node:assert/strict';
import { createPipeline, NO_MATCH_REPLY } from '../server/pipeline.js';

const config = { REWRITE_ENABLED: true, RERANK_ENABLED: true, RERANK_MIN_SCORE: 4, CONTEXT_SIZE: 2 };
const movies = [
  { id: 1, title: 'Inception', year: 2010, content: 'Inception (2010)...', score: 0.03 },
  { id: 2, title: 'Interstellar', year: 2014, content: 'Interstellar (2014)...', score: 0.02 },
  { id: 3, title: 'Superbad', year: 2007, content: 'Superbad (2007)...', score: 0.01 },
];

function build(overrides = {}) {
  const calls = { answer: 0, rewrite: 0 };
  const deps = {
    retriever: { embed: async () => [0.1], search: async () => movies, ...overrides.retriever },
    reranker:
      overrides.reranker ??
      (async (_q, c) => c.map((m, i) => ({ ...m, rerankScore: [9, 6, 1][i] })).sort((a, b) => b.rerankScore - a.rerankScore)),
    generator: {
      rewrite: async () => (calls.rewrite++, 'standalone query'),
      answer: async () => (calls.answer++, 'Try Inception [1] or Interstellar [2].'),
      ...overrides.generator,
    },
    config: { ...config, ...overrides.config },
  };
  return { run: createPipeline(deps), calls };
}

test('happy path: reranks, gates, answers and returns cited sources', async () => {
  const { run } = build();
  const out = await run({ message: 'mind-bending movie' });
  assert.match(out.reply, /Inception/);
  assert.deepEqual(out.sources.map((s) => s.title), ['Inception', 'Interstellar']);
  assert.deepEqual(out.meta.degraded, []);
});

test('relevance gate: returns the no-match reply without calling the LLM', async () => {
  const { run, calls } = build({
    reranker: async (_q, c) => c.map((m) => ({ ...m, rerankScore: 1 })),
  });
  const out = await run({ message: 'quantum cooking show' });
  assert.equal(out.reply, NO_MATCH_REPLY);
  assert.equal(calls.answer, 0);
});

test('rerank failure degrades to fused order', async () => {
  const { run } = build({ reranker: async () => { throw new Error('boom'); } });
  const out = await run({ message: 'anything' });
  assert.deepEqual(out.meta.degraded, ['rerank']);
  assert.equal(out.sources.length, 2);
});

test('embedding failure degrades to keyword-only search', async () => {
  let receivedEmbedding;
  const { run } = build({
    retriever: {
      embed: async () => { throw new Error('openai down'); },
      search: async (_q, e) => { receivedEmbedding = e; return movies; },
    },
  });
  const out = await run({ message: 'dream heist' });
  assert.equal(receivedEmbedding, null);
  assert.deepEqual(out.meta.degraded, ['embedding']);
});

test('follow-ups are rewritten; first messages are not', async () => {
  const first = build();
  await first.run({ message: 'hi', history: [] });
  assert.equal(first.calls.rewrite, 0);

  const follow = build();
  const out = await follow.run({ message: 'what about the second?', history: [{ role: 'user', content: 'x' }] });
  assert.equal(follow.calls.rewrite, 1);
  assert.equal(out.meta.query, 'standalone query');
});

test('search failure is fatal', async () => {
  const { run } = build({ retriever: { search: async () => { throw new Error('db down'); } } });
  await assert.rejects(run({ message: 'x' }), /db down/);
});
