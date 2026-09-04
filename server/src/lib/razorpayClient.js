const Razorpay = require('razorpay');

// Razorpay buildathon integration: the first actual use of RAZORPAY_KEY_ID/
// RAZORPAY_KEY_SECRET anywhere in this codebase — every other route only
// ever consumed Razorpay webhooks (RAZORPAY_WEBHOOK_SECRET, a different
// credential). Single shared client, same pattern as lib/prisma.js and
// lib/gemini.js — callers require this instead of constructing their own.
// Test-mode keys only; never point this at live keys from a demo app.
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

module.exports = razorpay;
