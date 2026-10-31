import { Router } from 'express';
import type { HealthService } from '../../services/healthService.js';
import { createHealthController } from '../controllers/health.controller.js';

export function healthRouter(healthService: HealthService): Router {
  const controller = createHealthController(healthService);
  const router = Router();
  router.get('/', controller.check);
  return router;
}
