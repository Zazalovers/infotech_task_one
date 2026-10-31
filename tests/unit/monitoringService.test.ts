import { pino } from 'pino';
import { describe, expect, it, vi } from 'vitest';
import { MonitoringService } from '../../src/services/monitoringService.js';

const silent = pino({ level: 'silent' });

describe('MonitoringService', () => {
  it('pings at most once per interval', async () => {
    let now = 0;
    const ping = vi.fn().mockResolvedValue(undefined);
    const monitoring = new MonitoringService({ ping }, 60_000, silent, () => now);

    await monitoring.reportWorkerAlive();
    now = 30_000;
    await monitoring.reportWorkerAlive();
    now = 60_000;
    await monitoring.reportWorkerAlive();

    expect(ping).toHaveBeenCalledTimes(2);
  });

  it('swallows ping failures', async () => {
    const monitoring = new MonitoringService({ ping: vi.fn().mockRejectedValue(new Error('down')) }, 1, silent);
    await expect(monitoring.reportWorkerAlive()).resolves.toBeUndefined();
  });

  it('does nothing without a pinger', async () => {
    const monitoring = new MonitoringService(null, 1, silent);
    await expect(monitoring.reportWorkerAlive()).resolves.toBeUndefined();
  });
});
