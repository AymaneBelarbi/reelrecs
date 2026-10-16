/** Tiny LRU cache (Map preserves insertion order). */
export class LRUCache {
  constructor(max = 500) {
    this.max = max;
    this.map = new Map();
  }
  get(key) {
    if (!this.map.has(key)) return undefined;
    const value = this.map.get(key);
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }
  set(key, value) {
    this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.max) this.map.delete(this.map.keys().next().value);
  }
}

/**
 * Turn free text into a safe OR-style tsquery string ("dream | heist").
 * Only [a-z0-9] tokens survive, so user input can never inject tsquery operators.
 * OR (rather than AND) keeps recall high for natural-language questions; ranking handles precision.
 */
export function buildKeywordQuery(text, maxTerms = 12) {
  const terms = [...new Set(String(text).toLowerCase().match(/[a-z0-9]{2,}/g) ?? [])];
  return terms.slice(0, maxTerms).join(' | ');
}

/** Extract unique citation numbers like [1], [3] from model output. */
export function parseCitations(text) {
  const nums = [...String(text).matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
  return [...new Set(nums)].sort((a, b) => a - b);
}

/** Run an async stage, recording its duration in `timings`. */
export async function timed(timings, name, fn) {
  const start = performance.now();
  try {
    return await fn();
  } finally {
    timings[name] = Math.round(performance.now() - start);
  }
}
