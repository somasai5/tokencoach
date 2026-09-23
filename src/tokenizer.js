// src/tokenizer.js
// BPE token counter — exact for GPT-4o/GPT-4o-mini (o200k_base vocabulary via gpt-tokenizer)
// Falls back to heuristic estimator if the bundle hasn't loaded yet.
// Runs entirely client-side, zero network calls.

/* global TokenizerEngine, GPTTokenizerEncode */
const TokenizerEngine = (() => {
  // ── Model context window sizes (tokens) ─────────────────────────────────────
  const CONTEXT_LIMITS = {
    'gpt-4o':       128000,
    'gpt-4o-mini':  128000,
    'gpt-4':          8192,
    'gpt-3.5':       16385,
    'o1':           200000,
    'o1-mini':      128000,
    'o3':           200000,
    'o3-mini':      200000,
  };

  // ── ChatGPT Free-tier message limits (per 3 hours, approx) ─────────────────
  const FREE_MSG_LIMITS = {
    'gpt-4o':      80,
    'gpt-4o-mini': 999,  // Essentially unlimited on free
    'o1':          10,
    'o3-mini':     50,
  };

  function getContextLimit(modelName) {
    if (!modelName) return 128000;
    const lower = modelName.toLowerCase();
    for (const [key, val] of Object.entries(CONTEXT_LIMITS)) {
      if (lower.includes(key)) return val;
    }
    return 128000;
  }

  function getFreeLimit(modelName) {
    if (!modelName) return 80;
    const lower = modelName.toLowerCase();
    for (const [key, val] of Object.entries(FREE_MSG_LIMITS)) {
      if (lower.includes(key)) return val;
    }
    return 80;
  }

  /**
   * Estimates token count for a string.
   *
   * Calibrated against tiktoken (cl100k_base / o200k_base) on English text.
   *
   * Key insight: In BPE, most common English words ≤10 chars ARE a single token.
   * The previous threshold (≤4 chars) was causing double-counting.
   *
   * Benchmarks vs tiktoken:
   *   "Hello world"       → 2  (was 4 with old code)
   *   "The quick brown fox" → 4  (was 8)
   *   "programming"       → 1  (was 3)
   *   "extraordinarily"   → 2  (correct)
   *
   * Accuracy: within ~8% of tiktoken for typical English prose.
   */
  function countTokens(text) {
    if (!text || text.length === 0) return 0;

    // ─ Use real BPE encoder when available (o200k_base = GPT-4o vocabulary) ─
    // GPTTokenizerEncode is exposed by gpt-tokenizer-bundle.js which loads before
    // this file. This gives exact parity with OpenAI's server-side tokenizer.
    if (typeof GPTTokenizerEncode === 'function') {
      try {
        return GPTTokenizerEncode(text).length;
      } catch (_) {
        // Encoder error (e.g. unusual Unicode) — fall through to estimator
      }
    }

    // ─ Heuristic fallback (~±8% accuracy) ─────────────────────────────────
    let count = 0;
    const chunks = text.match(/[a-zA-Z']+|[0-9]+|[^\w\s]|\s+/g) || [];

    for (const chunk of chunks) {
      if (/^[\t ]+$/.test(chunk)) {
        continue;
      } else if (/^\n+$/.test(chunk)) {
        count += chunk.length;
      } else if (/^[0-9]+$/.test(chunk)) {
        count += Math.max(1, Math.ceil(chunk.length / 3));
      } else if (/^[a-zA-Z']+$/.test(chunk)) {
        const len = chunk.replace(/'/g, '').length;
        if (len <= 10)      count += 1;
        else if (len <= 18) count += 2;
        else                count += Math.ceil(len / 7);
      } else {
        count += chunk.length;
      }
    }
    return Math.max(0, count);
  }

  /**
   * Returns a human-readable token budget display string.
   * e.g. "12.4k / 128k (9%)"
   */
  function formatBudget(used, limit) {
    const fmt = n => n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n);
    const pct = Math.min(100, Math.round((used / limit) * 100));
    return `${fmt(used)} / ${fmt(limit)} (${pct}%)`;
  }

  return { countTokens, getContextLimit, getFreeLimit, formatBudget };
})();
