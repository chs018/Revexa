import { createContext, useContext, useEffect, useState } from 'react';

const NowContext = createContext(null);

/**
 * One shared ticking clock for the whole app (mounted once in App.jsx).
 * Every SLA countdown reads from this instead of running its own
 * setInterval — with dozens of rows in the Queue table, N independent
 * per-row timers would mean N re-renders every second; this way it's one.
 */
export function NowProvider({ children, intervalMs = 1000 }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return <NowContext.Provider value={now}>{children}</NowContext.Provider>;
}

export function useNow() {
  const ctx = useContext(NowContext);
  if (ctx === null) {
    throw new Error('useNow() must be used inside <NowProvider>');
  }
  return ctx;
}
