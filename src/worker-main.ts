// Standalone worker process: `npm run start:worker`.
import { buildContainer } from './container.js';
import { onShutdown } from './shutdown.js';

const container = buildContainer();
const worker = container.buildWorker();
worker.start();

onShutdown(async () => {
  await worker.stop();
  await container.close();
});
