import { useEffect, useRef, useState } from 'react';

// New functionality (Part C's dwell gate, not a restyle): counts down from
// durationMs using requestAnimationFrame, not setInterval — a mandatory
// pause has to reflect wall-clock time even if the tab is backgrounded and
// timers get throttled, not just "N ticks happened." `done` only flips true
// once the timer has actually run to completion via start(); it starts
// false-but-not-done in the pre-start state (remainingMs === durationMs
// with running=false) so a caller can't accidentally read "done" before the
// gate was ever engaged.
export function useDwellTimer(durationMs) {
  const [remainingMs, setRemainingMs] = useState(durationMs);
  const [running, setRunning] = useState(false);
  const [everStarted, setEverStarted] = useState(false);
  const endAtRef = useRef(null);
  const rafRef = useRef(null);

  useEffect(() => {
    if (!running) return undefined;

    function tick() {
      const left = Math.max(0, endAtRef.current - Date.now());
      setRemainingMs(left);
      if (left > 0) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        setRunning(false);
      }
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [running]);

  function start() {
    endAtRef.current = Date.now() + durationMs;
    setRemainingMs(durationMs);
    setEverStarted(true);
    setRunning(true);
  }

  function reset() {
    setRunning(false);
    setEverStarted(false);
    setRemainingMs(durationMs);
  }

  return { remainingMs, done: everStarted && !running && remainingMs <= 0, start, reset };
}
