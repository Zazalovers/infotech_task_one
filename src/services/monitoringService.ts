import type { Logger } from '../config/logger.js';
import type { HeartbeatPinger } from './ports/heartbeatPinger.js';

/** Reports worker liveness to an external heartbeat monitor (Asniher), throttled and best-effort. */
export class MonitoringService {
  private lastPingAt = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly pinger: HeartbeatPinger | null,
    private readonly intervalMs: number,
    private readonly logger: Logger,
    private readonly now: () => number = Date.now,
  ) {}

  async reportWorkerAlive(): Promise<void> {
    if (!this.pinger) return;
    const now = this.now();
    if (now - this.lastPingAt < this.intervalMs) return;
    this.lastPingAt = now;

    try {
      await this.pinger.ping();
      this.logger.debug('heartbeat.sent');
    } catch (err) {
      // A monitoring hiccup must never affect email processing.
      this.logger.warn({ err }, 'heartbeat.failed');
    }
  }
}
