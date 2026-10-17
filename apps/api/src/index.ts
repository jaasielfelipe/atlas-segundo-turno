import { createServer } from './server';

// pnpm start: telão at http://127.0.0.1:3201/telao. LIVE_DB / BASELINE_DB / ATLAS_API_PORT override.
const app = await createServer({
  livePath: process.env.LIVE_DB ?? 'data/official/round2/collection.sqlite',
  baselinePath: process.env.BASELINE_DB ?? 'data/baseline/round1.sqlite',
});
const port = Number(process.env.ATLAS_API_PORT ?? 3201);
await app.listen({ host: '127.0.0.1', port });
console.log(`Atlas do 2º turno: http://127.0.0.1:${port}/telao`);
