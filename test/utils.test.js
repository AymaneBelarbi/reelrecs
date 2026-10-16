import test from 'node:test';
import assert from 'node:assert/strict';
import { LRUCache, buildKeywordQuery, parseCitations } from '../server/lib/utils.js';

test('buildKeywordQuery produces an OR query and strips operators', () => {
  assert.equal(buildKeywordQuery('Mind-bending heist!'), 'mind | bending | heist');
  assert.equal(buildKeywordQuery("x' | ! & ( ) <-> evil"), 'evil');
  assert.equal(buildKeywordQuery('a b'), '');
  assert.equal(buildKeywordQuery('dream dream dream'), 'dream');
});

test('buildKeywordQuery caps the number of terms', () => {
  const q = buildKeywordQuery(Array.from({ length: 30 }, (_, i) => `word${i}`).join(' '));
  assert.equal(q.split(' | ').length, 12);
});

test('parseCitations returns sorted unique numbers', () => {
  assert.deepEqual(parseCitations('See [2], then [1] and [2] again.'), [1, 2]);
  assert.deepEqual(parseCitations('no citations'), []);
});

test('LRUCache evicts the least recently used entry', () => {
  const cache = new LRUCache(2);
  cache.set('a', 1);
  cache.set('b', 2);
  cache.get('a');
  cache.set('c', 3);
  assert.equal(cache.get('b'), undefined);
  assert.equal(cache.get('a'), 1);
  assert.equal(cache.get('c'), 3);
});
