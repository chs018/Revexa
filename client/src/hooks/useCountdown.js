import { useNow } from './useNow';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Pure computation — deadline vs. now, both plain timestamps. No timer of
 * its own; the "every second" requirement is satisfied by the shared clock
 * in useNow.js re-rendering whatever calls this.
 */
export function formatCountdown(deadline, now) {
  const deadlineMs = new Date(deadline).getTime();
  const remainingMs = deadlineMs - now;
  const overdue = remainingMs < 0;
  const abs = Math.abs(remainingMs);

  const days = Math.floor(abs / DAY);
  const hours = Math.floor((abs % DAY) / HOUR);
  const minutes = Math.floor((abs % HOUR) / MINUTE);

  let text;
  if (days > 0) text = `${days}d ${hours}h ${minutes}m`;
  else if (hours > 0) text = `${hours}h ${minutes}m`;
  else text = `${minutes}m`;

  let tone = 'neutral';
  if (overdue) tone = 'danger';
  else if (remainingMs < DAY) tone = 'caution';

  return { text: overdue ? `Overdue ${text}` : text, overdue, tone, remainingMs };
}

export function useCountdown(deadline) {
  const now = useNow();
  return formatCountdown(deadline, now);
}
