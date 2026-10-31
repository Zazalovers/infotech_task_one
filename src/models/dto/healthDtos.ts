export interface AppHealth {
  status: 'up';
  version: string;
  uptimeSeconds: number;
}

export type DatabaseHealth = { status: 'up'; latencyMs: number } | { status: 'down'; error: string };

export interface HealthReport {
  status: 'ok' | 'error';
  timestamp: string;
  app: AppHealth;
  database: DatabaseHealth;
}
