import { useEffect, useRef, useState, useCallback } from 'react';
import { io } from 'socket.io-client';
import { API_BASE_URL, getDisputes } from '../lib/api';

// Live Activity feed rework (v2): a rolling 15-minute window, not a
// hover-to-dismiss queue. An item shows for exactly 15 minutes from when it
// happened, then disappears on its own — no interaction required, and
// nothing sticks around past its window even if never looked at. Replaces
// the hover/mouseleave dismiss mechanism entirely (removed, not layered on
// top of this — two different eviction rules on one list would fight each
// other and confuse both).
const FEED_WINDOW_MS = 15 * 60 * 1000;
const PRUNE_INTERVAL_MS = 15 * 1000; // how often the sweep re-checks ages — frequent enough to feel immediate, cheap enough not to matter

/**
 * Connects to the server's Socket.io endpoint once on mount and listens for
 * "dispute:updated" events. Exposes:
 *   - events: everything that's happened in the last 15 minutes, newest
 *     first, capped to `feedLimit` as a hard safety ceiling
 *   - connected: current connection state (survives reconnects — see below)
 *   - onUpdate(fn): register a callback fired with each raw incoming
 *     dispute, for callers that want to merge updates into their own
 *     dispute list state rather than just read the feed array.
 *
 * Socket.io-client reconnects automatically by default; this hook just
 * makes that explicit and keeps `connected` in sync, so a dropped
 * connection doesn't silently kill the live feed for the rest of the
 * session — it reconnects and keeps emitting into the same state.
 *
 * `events` used to start as a bare [] with no history at all — the ONLY
 * piece of state in this whole app with zero REST backing, so it always
 * read as "broken" after anything happened before the tab was open. Fixed
 * by seeding from GET /disputes on mount — but seeding is now scoped to
 * the same 15-minute window everything else obeys (see below), so a fresh
 * page load shows genuinely recent activity, not an unbounded dispute
 * history — that's what Queue/Audit Trail are for.
 */
export function useSocket({ feedLimit = 50 } = {}) {
  const [events, setEvents] = useState([]);
  const [connected, setConnected] = useState(false);
  const listenersRef = useRef(new Set());

  const onUpdate = useCallback((fn) => {
    listenersRef.current.add(fn);
    return () => listenersRef.current.delete(fn);
  }, []);

  // Seeds recent history once on mount. Independent of the socket effect
  // below — whichever resolves first doesn't matter, since the merge on
  // write only adds a seeded row for a dispute that no live event has
  // already placed in the array (see the liveIds check), so a live event
  // that lands mid-fetch always wins over the seed for that same dispute.
  useEffect(() => {
    let cancelled = false;
    getDisputes()
      .then((disputes) => {
        if (cancelled) return;
        const cutoff = Date.now() - FEED_WINDOW_MS;
        const seeded = disputes
          .map((dispute) => ({
            ...dispute,
            // null, not a guess — a seeded row reflects a dispute's CURRENT
            // state, not a specific action that just happened, so
            // activityLabel() correctly falls back to the status-based
            // label for these instead of claiming false precision.
            _action: null,
            _eventId: `seed-${dispute.id}`,
            _receivedAt: new Date(dispute.updatedAt).getTime(),
          }))
          .filter((e) => e._receivedAt >= cutoff) // no point seeding something the prune sweep would remove within seconds
          .sort((a, b) => b._receivedAt - a._receivedAt)
          .slice(0, feedLimit);
        setEvents((prev) => {
          const liveIds = new Set(prev.map((e) => e.id));
          const seededOnly = seeded.filter((e) => !liveIds.has(e.id));
          return [...prev, ...seededOnly].slice(0, feedLimit);
        });
      })
      .catch(() => {}); // best-effort — an empty feed on failure is the pre-existing behavior, not a regression
    return () => {
      cancelled = true;
    };
  }, [feedLimit]);

  // The sweep that actually makes items disappear at 15 minutes — a plain
  // setInterval re-filtering on every tick, not one setTimeout scheduled
  // per item. Simpler, and there's nothing to individually clean up when an
  // item's already been removed some other way (e.g. never — nothing else
  // removes items anymore — but this stays robust either way).
  useEffect(() => {
    const prune = () => {
      const cutoff = Date.now() - FEED_WINDOW_MS;
      setEvents((prev) => {
        const next = prev.filter((e) => e._receivedAt >= cutoff);
        return next.length === prev.length ? prev : next; // avoid a no-op re-render every tick
      });
    };
    const id = setInterval(prune, PRUNE_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const socket = io(API_BASE_URL, {
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));

    socket.on('dispute:updated', (dispute) => {
      const event = {
        ...dispute,
        _eventId: `${dispute.id}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        _receivedAt: Date.now(),
      };
      setEvents((prev) => {
        // De-dups on (disputeId, action), not (disputeId, status) — status
        // alone used to collapse genuinely different moments that happen to
        // leave a dispute at the same status (e.g. "drafted" and
        // "evidence_flagged" both leave status: "drafted"; they're now
        // different _action values and correctly stay as two rows). This
        // only catches a true accidental re-emit of the exact same action
        // for the exact same dispute in a row.
        if (prev[0] && prev[0].id === dispute.id && prev[0]._action === dispute._action) {
          return [event, ...prev.slice(1)];
        }
        return [event, ...prev].slice(0, feedLimit);
      });
      listenersRef.current.forEach((fn) => fn(dispute));
    });

    return () => {
      socket.disconnect();
    };
  }, [feedLimit]);

  return { events, connected, onUpdate };
}
