const { GoogleGenAI } = require('@google/genai');

// Without an explicit timeout, a stalled request to Gemini hangs forever —
// no resolve, no reject. Since every call goes through geminiLimiter
// (lib/limiter.js, concurrency 5), a single hung call would permanently
// occupy one of those 5 slots: nothing frees it, so it never gets replaced
// by a new task. Enough of those over a long-running process's lifetime and
// the limiter silently starves — every future dispute just sits at its
// current status forever, no error, no audit log, nothing to debug against.
// A timeout guarantees every call eventually settles one way or another.
const REQUEST_TIMEOUT_MS = 20000;

// Single shared Gemini client, same pattern as lib/prisma.js — agents
// require this instead of each constructing their own.
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: { timeout: REQUEST_TIMEOUT_MS },
});

module.exports = ai;
