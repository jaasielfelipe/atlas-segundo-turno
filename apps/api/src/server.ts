import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { TelaoSource } from './telao';

/**
 * Local telão server (127.0.0.1 only): read-only API over the 2nd-round collection and the
 * 1st-round baseline, plus the built web app.
 */
export async function createServer({
  livePath,
  baselinePath,
  root = process.cwd(),
  web = resolve(root, 'dist/web'),
}: {
  livePath: string;
  baselinePath: string;
  root?: string;
  web?: string;
}) {
  const app = Fastify({ logger: false });
  const source = new TelaoSource(livePath, baselinePath, root);
  app.addHook('onClose', async () => source.close());
  const unavailable = (reply: { code: (n: number) => { send: (b: unknown) => unknown } }) =>
    reply.code(503).send({
      error: 'Acervo do 2º turno ainda não coletado. Execute pnpm collect:official:live.',
    });
  app.get('/api/telao/bootstrap', async (_request, reply) => {
    const boot = source.bootstrap();
    if (!boot) return unavailable(reply);
    const { segmentIndex: _index, ...body } = boot;
    return body;
  });
  app.get('/api/telao/events', async (request, reply) => {
    const q = z.object({ after: z.coerce.number().int().min(0).default(0) }).parse(request.query);
    if (!source.bootstrap()) return unavailable(reply);
    return source.events(q.after);
  });
  app.get('/api/telao/official', async (_request, reply) => {
    const official = source.official();
    return official ?? unavailable(reply);
  });
  app.get('/api/telao/status', async () => source.status());
  app.get('/health', async () => ({ ok: true }));
  if (existsSync(web)) {
    await app.register(fastifyStatic, { root: web });
    // Client-side routes (/telao, /prototipo/...) fall back to the app shell.
    app.setNotFoundHandler((request, reply) =>
      request.url.startsWith('/api/')
        ? reply.code(404).send({ error: 'Rota inexistente' })
        : reply.sendFile('index.html'),
    );
  }
  return app;
}
