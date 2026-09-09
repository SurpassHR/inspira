import { serve } from '@hono/node-server';
import { app } from './app.js';
import { startCoverRetryTimer } from './cover-retry.js';
import { startInspirationRetryTimer } from './inspiration-retry.js';
import { restartScheduler } from './scheduler.js';
import { initStore } from './store.js';

await initStore();
restartScheduler();
startCoverRetryTimer();
startInspirationRetryTimer();

serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 8787) }, (info) => {
  console.log(`✦ Inspira 灵感生成器已启动: http://localhost:${info.port}`);
});