import type { Request, Response } from 'express';
import type { HealthService } from '../../services/healthService.js';

export function createHealthController(healthService: HealthService) {
  return {
    async check(_req: Request, res: Response): Promise<void> {
      const report = await healthService.check();
      res
        .set('Cache-Control', 'no-store')
        .status(report.status === 'ok' ? 200 : 503)
        .json(report);
    },
  };
}
