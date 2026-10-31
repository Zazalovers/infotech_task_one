import type { HeartbeatPinger } from '../ports/heartbeatPinger.js';

const PING_TIMEOUT_MS = 5000;

/** Pings an Asniher heartbeat monitor URL. */
export class AsniherHeartbeat implements HeartbeatPinger {
  constructor(private readonly url: string) {}

  async ping(): Promise<void> {
    const res = await fetch(this.url, { method: 'GET', signal: AbortSignal.timeout(PING_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`heartbeat ping returned ${res.status}`);
  }
}
