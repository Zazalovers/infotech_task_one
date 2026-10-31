import { describe, expect, it } from 'vitest';
import { computeBackoffMs } from '../../src/services/retryPolicy.js';

describe('computeBackoffMs', () => {
  const noJitter = () => 0.5;

  it('doubles the delay for each failed attempt', () => {
    expect(computeBackoffMs(1, 10_000, noJitter)).toBe(10_000);
    expect(computeBackoffMs(2, 10_000, noJitter)).toBe(20_000);
    expect(computeBackoffMs(3, 10_000, noJitter)).toBe(40_000);
  });

  it('applies at most ±20% jitter', () => {
    expect(computeBackoffMs(1, 10_000, () => 0)).toBe(8_000);
    expect(computeBackoffMs(1, 10_000, () => 1)).toBe(12_000);
  });
});
