import { createServer } from './server';

// pnpm start: telão at http://127.0.0.1:3201/telao. LIVE_DB / BASELINE_DB / ATLAS_API_PORT override.
// ATLAS_API_HOST (default 127.0.0.1): only for a server behind a reverse proxy or in a container.
const app = await createServer({
  livePath: process.env.LIVE_DB ?? 'data/official/round2/collection.sqlite',
  baselinePath: process.env.BASELINE_DB ?? 'data/baseline/round1.sqlite',
});
const port = Number(process.env.ATLAS_API_PORT ?? 3201);
const host = process.env.ATLAS_API_HOST ?? '127.0.0.1';
await app.listen({ host, port });
console.log(`Atlas do 2º turno: http://${host}:${port}/telao`);
