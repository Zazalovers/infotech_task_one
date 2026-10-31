import { DatabaseTimeoutError, type HealthRepository } from '../data/repositories/healthRepository.js';
import type { HealthReport } from '../models/dto/healthDtos.js';

export interface HealthServiceOptions {
  version: string;
  dbTimeoutMs: number;
}

export class HealthService {
  private readonly startedAt = Date.now();

  constructor(
    private readonly health: HealthRepository,
    private readonly options: HealthServiceOptions,
  ) {}

  /** Only the database decides overall status; details are kept generic so nothing sensitive leaks. */
  async check(): Promise<HealthReport> {
    const base = {
      timestamp: new Date().toISOString(),
      app: {
        status: 'up' as const,
        version: this.options.version,
        uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      },
    };

    try {
      const latencyMs = await this.health.ping(this.options.dbTimeoutMs);
      return { status: 'ok', ...base, database: { status: 'up', latencyMs } };
    } catch (err) {
      const error = err instanceof DatabaseTimeoutError ? 'timeout' : 'unreachable';
      return { status: 'error', ...base, database: { status: 'down', error } };
    }
  }
}
