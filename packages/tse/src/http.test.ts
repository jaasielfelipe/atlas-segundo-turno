import { expect, it, vi } from 'vitest';
import { tseTransport } from './http';
import { ConservativeCollector } from './collector';
const q = new ConservativeCollector();
q.add({
  key: 'a',
  url: 'https://resultados.tse.jus.br/oficial/ele2026/test.json',
  kind: 'zone',
  priority: 0,
});
const job = q.jobs.get('a')!;
it('origem/fase/corpo validados antes de aceitar cache, redirects proibidos', async () => {
  const validate = vi.fn();
  const request = vi.fn(async () => new Response('{"f":"o"}', { headers: { etag: 'test' } }));
  const transport = tseTransport({ fetch: request as typeof fetch, validate });
  expect(await transport(job, { 'If-None-Match': 'prior' })).toMatchObject({
    status: 200,
    etag: 'test',
    raw: '{"f":"o"}',
  });
  expect(request.mock.calls[0]).toEqual([
    job.url,
    expect.objectContaining({ redirect: 'error', headers: { 'If-None-Match': 'prior' } }),
  ]);
  expect(validate).toHaveBeenCalledOnce();
  await expect(transport({ ...job, url: 'https://example.com/oficial/test' }, {})).rejects.toThrow(
    'Origem',
  );
  const wrong = tseTransport({ fetch: async () => new Response('{"f":"s"}'), validate });
  await expect(wrong(job, {})).rejects.toThrow('Fase');
});
it('limita bytes, rejeita JSON truncado e respeita Retry-After sem retry automático', async () => {
  await expect(
    tseTransport({ fetch: async () => new Response('{"f":"o"}'), maxBytes: 3, validate: () => {} })(
      job,
      {},
    ),
  ).rejects.toThrow('bytes');
  await expect(
    tseTransport({ fetch: async () => new Response('{'), validate: () => {} })(job, {}),
  ).rejects.toThrow();
  const result = await tseTransport({
    fetch: async () => new Response(null, { status: 429, headers: { 'retry-after': '900' } }),
    validate: () => {
      throw Error('não deveria validar erro');
    },
  })(job, {});
  expect(result).toMatchObject({ status: 429, retryAfterMs: 900000 });
});

it('propaga conclusão somente após validação do corpo e contexto', async () => {
  const transport = tseTransport({
    fetch: async () => new Response('{"f":"o"}'),
    validate: () => ({ complete: false }),
  });
  expect(await transport(job, {})).toMatchObject({ status: 200, complete: false });
});
