/**
 * Layer rules (see docs/SPEC.md §2.2):
 *   api / worker  →  services  →  data  →  models
 * config is cross-cutting and depends on no layer.
 * src/container.ts, src/server.ts and src/worker-main.ts are composition roots and may wire everything.
 */
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'api-only-calls-services',
      comment: 'api may use services, models and config only',
      severity: 'error',
      from: { path: '^src/api/' },
      to: { path: '^src/(data|worker)/' },
    },
    {
      name: 'worker-only-calls-services',
      severity: 'error',
      from: { path: '^src/worker/' },
      to: { path: '^src/(data|api)/' },
    },
    {
      name: 'services-not-upward',
      severity: 'error',
      from: { path: '^src/services/' },
      to: { path: '^src/(api|worker)/' },
    },
    {
      name: 'data-not-upward',
      severity: 'error',
      from: { path: '^src/data/' },
      to: { path: '^src/(api|worker|services)/' },
    },
    {
      name: 'models-are-leaf',
      comment: 'models are plain types and depend on nothing else in src',
      severity: 'error',
      from: { path: '^src/models/' },
      to: { path: '^src/(?!models/)' },
    },
    {
      name: 'config-is-leaf',
      severity: 'error',
      from: { path: '^src/config/' },
      to: { path: '^src/(api|worker|services|data|models)/' },
    },
    {
      name: 'pg-only-in-data',
      comment: 'all database access lives in src/data',
      severity: 'error',
      from: { path: '^src/', pathNot: '^src/data/' },
      to: { path: 'node_modules/pg/' },
    },
    {
      name: 'http-only-in-api',
      comment: 'no HTTP framework outside src/api',
      severity: 'error',
      from: { path: '^src/', pathNot: '^src/api/' },
      to: { path: 'node_modules/(express|pino-http)/' },
    },
    {
      name: 'resend-only-in-provider',
      severity: 'error',
      from: { pathNot: '^src/services/providers/' },
      to: { path: 'node_modules/resend/' },
    },
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      extensions: ['.ts', '.js', '.json'],
    },
  },
};
