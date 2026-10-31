const JITTER_RATIO = 0.2;

/**
 * Delay before the next attempt, after `attempt` failed attempts (1-based).
 * Exponential: base, 2×base, 4×base, … with ±20 % jitter so retries don't line up.
 */
export function computeBackoffMs(attempt: number, baseMs: number, random: () => number = Math.random): number {
  const exponential = baseMs * 2 ** Math.max(0, attempt - 1);
  const jitter = exponential * JITTER_RATIO * (random() * 2 - 1);
  return Math.round(exponential + jitter);
}
