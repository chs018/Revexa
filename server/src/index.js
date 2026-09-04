require('dotenv').config();

const http = require('http');
const express = require('express');
const cors = require('cors');
const prisma = require('./lib/prisma');
const { initSocket } = require('./lib/socket');

const webhooksRouter = require('./routes/webhooks');
const demoRouter = require('./routes/demo');
const disputesRouter = require('./routes/disputes');
const metricsMlRouter = require('./routes/metricsMl');

// The client's Vite dev server origin. Hardcoded default is fine for local
// dev — tighten this (env-driven, restricted to the real deployed origin)
// before Day 7's deploy.
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';

const app = express();

app.use(cors());

// Mounted before the global express.json() below, so its own express.raw()
// middleware (inside routes/webhooks.js) is what consumes the request body
// for /webhooks/razorpay — the raw bytes are needed for signature
// verification. Every other route gets normal JSON parsing.
app.use('/webhooks', webhooksRouter);

app.use(express.json());

app.use('/demo', demoRouter);
app.use(disputesRouter); // defines its own full paths: /disputes, /disputes/:id, /audit-logs
app.use(metricsMlRouter); // defines /metrics-ml — separate from disputes.js's /metrics on purpose

// Small set of tunables the client needs to render correctly (e.g. the
// confidence gauge's threshold marker) without duplicating server config.
app.get('/config', (req, res) => {
  res.json({
    confidenceThreshold: Number(process.env.CONFIDENCE_THRESHOLD),
  });
});

// A DB outage (Neon has genuinely gone unreachable more than once during
// this build) used to make this route hang indefinitely — the Postgres
// client has no built-in query timeout, so a dead network connection just
// never resolves or rejects. That silence was hard to tell apart from a
// dozen other possible failures ("is the server even running? is the
// route broken? is it just slow?"), and cost real debugging time each time
// it happened. Racing the query against a 5s timer means an outage now
// reports itself in 5 seconds flat, correctly, instead of leaving the
// caller to guess.
function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

app.get('/health', async (req, res) => {
  try {
    await withTimeout(prisma.$queryRaw`SELECT 1`, 5000, 'DB health check');
    res.json({ status: 'ok', db: 'connected' });
  } catch (err) {
    res.status(500).json({ status: 'error', db: 'disconnected', error: err.message });
  }
});

// Fallback error handler — Express 5 forwards thrown/rejected errors from
// async route handlers here automatically. Without this, an error (e.g. a
// missing env var, a DB error) leaks a raw HTML stack trace to the caller.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'internal_error', message: err.message });
});

const PORT = process.env.PORT || 4000;

async function start() {
  // socket.io needs a raw http.Server to attach to, not just the Express
  // app — this is why we build one explicitly instead of using
  // app.listen(). Only constructed when actually starting the server (see
  // require.main check below) — tests import `app` directly via
  // Supertest, which doesn't need a listening server or a socket.io
  // instance at all (emitDisputeUpdate() already no-ops gracefully with no
  // initSocket() call — see lib/socket.js).
  const server = http.createServer(app);

  initSocket(server, {
    cors: {
      origin: CLIENT_ORIGIN,
      methods: ['GET', 'POST'],
    },
  });

  try {
    await prisma.$connect();
    console.log('Prisma connected to database.');
  } catch (err) {
    console.error('Failed to connect Prisma to database:', err.message);
  }

  server.listen(PORT, () => {
    console.log(`Revexa server listening on http://localhost:${PORT}`);
  });

  // Root cause of a recurring `node --watch` dev-loop failure: only SIGINT
  // was ever handled here. `node --watch` sends SIGTERM to the old process
  // on every restart (a file save), not SIGINT — with no SIGTERM handler,
  // Node's default action kills the process immediately without ever
  // calling server.close(), so the OS hasn't necessarily released the
  // listening socket yet (a real, reproducible delay on Windows) by the
  // time --watch spawns the replacement process a moment later. The new
  // process's server.listen(PORT) then races an old socket that's still
  // technically bound, and crashes with EADDRINUSE — deterministically, on
  // every single restart, not intermittently, which is exactly what kept
  // happening this session. server.close() below unbinds the port
  // synchronously (its callback fires once the OS confirms it's free)
  // before this process disconnects Prisma and exits, so the next process
  // never races it.
  // Second hardening: if the DB is unreachable (the exact scenario that
  // exposed this), prisma.$disconnect() can itself hang trying to close a
  // connection that was never really open — which would mean server.close()
  // never gets past its own callback and this process never exits. That's
  // worse than the original EADDRINUSE bug: a hung old process holds the
  // port forever, and no amount of retrying `npm run dev` fixes it (this is
  // exactly the pileup that happened — three separate --watch supervisors
  // accumulated over several days because none of their old processes ever
  // actually died). A 3s hard-exit fallback guarantees this process is gone
  // one way or another, so the NEXT process always gets a fair shot at the
  // port.
  let shuttingDown = false;
  function gracefulShutdown() {
    if (shuttingDown) return; // both signals can arrive in quick succession
    shuttingDown = true;
    const forceExit = setTimeout(() => {
      console.warn('Graceful shutdown did not complete in time — forcing exit.');
      process.exit(1);
    }, 3000);
    forceExit.unref(); // never keep the process alive on its own
    server.close(async () => {
      try {
        await withTimeout(prisma.$disconnect(), 2000, 'Prisma disconnect');
      } catch (err) {
        console.warn('Prisma disconnect did not complete cleanly:', err.message);
      }
      clearTimeout(forceExit);
      process.exit(0);
    });
  }
  process.on('SIGINT', gracefulShutdown);
  process.on('SIGTERM', gracefulShutdown);
}

// Part B: only auto-starts when run directly (`node src/index.js`, via
// `npm start`/`npm run dev`) — required as a module (tests/*.test.js, via
// Supertest) just gets the bare `app` with nothing listening.
if (require.main === module) {
  start();
}

module.exports = app;
