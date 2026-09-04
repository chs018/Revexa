function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs `fn`, retrying with exponential backoff on failure. Throws the last
 * error if every attempt is exhausted — callers are expected to catch that
 * and apply their own terminal fallback (e.g. marking a row needs_attention),
 * this helper doesn't know anything about the domain.
 *
 * @param {(attempt: number) => Promise<T>} fn
 * @param {{ attempts?: number, baseDelayMs?: number }} [options]
 * @returns {Promise<T>}
 */
async function withRetry(fn, { attempts = 3, baseDelayMs = 300 } = {}) {
  let lastErr;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      console.warn(`[retry] attempt ${attempt}/${attempts} failed: ${err.message}`);
      if (attempt < attempts) {
        await sleep(baseDelayMs * 2 ** (attempt - 1));
      }
    }
  }

  throw lastErr;
}

module.exports = { withRetry, sleep };
