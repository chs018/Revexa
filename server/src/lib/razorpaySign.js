const crypto = require('crypto');

/**
 * HMAC-SHA256 signs a JSON-serializable payload using RAZORPAY_WEBHOOK_SECRET,
 * the same way Razorpay signs outgoing webhook bodies.
 *
 * Used in two directions:
 *   - to verify the `x-razorpay-signature` header on real incoming webhooks
 *     (recompute the signature over the raw body and compare).
 *   - to sign synthetic/test events so they are byte-for-byte indistinguishable
 *     from real webhook deliveries when fed into the same verification path.
 *
 * @param {object|string} payload - The webhook body. If an object is passed it
 *   is JSON.stringify'd; if a string is passed it is signed as-is (use the raw
 *   request body string when verifying real webhooks, since re-serializing a
 *   parsed object can produce different bytes than what Razorpay actually sent).
 * @param {string} [secret] - Defaults to process.env.RAZORPAY_WEBHOOK_SECRET.
 * @returns {string} hex-encoded HMAC-SHA256 signature.
 */
function signPayload(payload, secret = process.env.RAZORPAY_WEBHOOK_SECRET) {
  if (!secret) {
    throw new Error('RAZORPAY_WEBHOOK_SECRET is not set');
  }

  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);

  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

/**
 * Verifies that `signature` matches the HMAC-SHA256 of `payload` under the
 * webhook secret, using a timing-safe comparison.
 *
 * @param {object|string} payload
 * @param {string} signature - hex-encoded signature to check against.
 * @param {string} [secret] - Defaults to process.env.RAZORPAY_WEBHOOK_SECRET.
 * @returns {boolean}
 */
function verifySignature(payload, signature, secret = process.env.RAZORPAY_WEBHOOK_SECRET) {
  const expected = signPayload(payload, secret);

  const expectedBuf = Buffer.from(expected, 'hex');
  const actualBuf = Buffer.from(String(signature || ''), 'hex');

  if (expectedBuf.length !== actualBuf.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuf, actualBuf);
}

module.exports = { signPayload, verifySignature };
