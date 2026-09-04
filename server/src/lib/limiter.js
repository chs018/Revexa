const pLimit = require('p-limit');

// p-limit v4+ is pure ESM and won't `require()` in this CommonJS project —
// pinned to 3.1.0 in package.json deliberately, don't bump past v3.

const MAX_CONCURRENT_GEMINI_CALLS = 5;

// One shared limiter for the whole process. Every caller must import this
// same instance rather than constructing their own pLimit() — a fresh
// limiter per call would each allow 5 concurrent calls independently,
// which isn't a cap on anything. This is what makes the concurrency cap
// real once disputes start getting triggered in a batch (Day 7).
const geminiLimiter = pLimit(MAX_CONCURRENT_GEMINI_CALLS);

module.exports = geminiLimiter;
