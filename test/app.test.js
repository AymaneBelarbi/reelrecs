import test from 'node:test';
import assert from 'node:assert/strict';
import pino from 'pino';
import { createApp } from '../server/app.js';

const config = { TRUST_PROXY: 0, RATE_LIMIT_PER_MIN: 5, NODE_ENV: 'test' };

async function start({ pipeline, checkReady = async () => {}, rateLimit = 5 } = {}) {
  const calls = [];
  const app = createApp({
    pipeline: pipeline ?? (async (input) => (calls.push(input), { reply: 'ok', sources: [], meta: {} })),
    config: { ...config, RATE_LIMIT_PER_MIN: rateLimit },
    logger: pino({ level: 'silent' }),
    checkReady,
  });
  const server = app.listen(0);
  const base = `http://localhost:${server.address().port}`;
  const post = (body, headers = {}) =>
    fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
  return { base, post, calls, close: () => server.close() };
}

test('health and readiness endpoints', async () => {
  const ok = await start();
  assert.equal((await fetch(`${ok.base}/health`)).status, 200);
  assert.equal((await fetch(`${ok.base}/ready`)).status, 200);
  ok.close();

  const down = await start({ checkReady: async () => { throw new Error('db down'); } });
  assert.equal((await fetch(`${down.base}/ready`)).status, 503);
  down.close();
});

test('rejects invalid input with 400', async () => {
  const s = await start();
  assert.equal((await s.post({ message: '   ' })).status, 400);
  assert.equal((await s.post({ message: 'x'.repeat(501) })).status, 400);
  assert.equal((await s.post('{oops')).status, 400);
  assert.equal((await s.post({ message: 'hi', history: [{ role: 'system', content: 'x' }] })).status, 400);
  assert.equal(s.calls.length, 0);
  s.close();
});

test('long conversations are trimmed to the last 10 messages instead of failing', async () => {
  const s = await start();
  const history = Array.from({ length: 14 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `m${i}` }));
  const res = await s.post({ message: 'next', history });
  assert.equal(res.status, 200);
  assert.equal(s.calls[0].history.length, 10);
  assert.equal(s.calls[0].history.at(-1).content, 'm13');
  s.close();
});

test('oversized bodies return 413', async () => {
  const s = await start();
  const res = await s.post({ message: 'hi', pad: 'x'.repeat(70_000) });
  assert.equal(res.status, 413);
  s.close();
});

test('pipeline failure returns 503 without leaking details', async () => {
  const s = await start({ pipeline: async () => { throw new Error('secret internal detail'); } });
  const res = await s.post({ message: 'hi' });
  assert.equal(res.status, 503);
  assert.doesNotMatch(await res.text(), /secret/);
  s.close();
});

test('rate limiter returns 429 after the limit', async () => {
  const s = await start({ rateLimit: 2 });
  assert.equal((await s.post({ message: 'a' })).status, 200);
  assert.equal((await s.post({ message: 'b' })).status, 200);
  assert.equal((await s.post({ message: 'c' })).status, 429);
  s.close();
});

test('untrusted X-Request-Id values are replaced', async () => {
  const s = await start();
  const bad = await s.post({ message: 'hi' }, { 'x-request-id': 'bad id\twith spaces' });
  assert.match(bad.headers.get('x-request-id'), /^[0-9a-f-]{36}$/);
  const good = await s.post({ message: 'hi' }, { 'x-request-id': 'trace-123' });
  assert.equal(good.headers.get('x-request-id'), 'trace-123');
  s.close();
});
