import { validateOrigin, validatePhase } from './index';
import type { CollectJob, CollectResponse } from './collector';

export type HttpResult = CollectResponse & { raw?: string };
export function tseTransport(options: {
  fetch?: typeof fetch;
  timeoutMs?: number;
  maxBytes?: number;
  now?: () => number;
  validate: (raw: string, job: Readonly<CollectJob>) => void | { complete: boolean };
}) {
  const request = options.fetch ?? fetch,
    max = options.maxBytes ?? 4 * 1024 * 1024;
  return async (
    job: Readonly<CollectJob>,
    headers: Record<string, string>,
  ): Promise<HttpResult> => {
    const environment =
      new URL(job.url).hostname === 'resultados.tse.jus.br' ? 'official' : 'simulated';
    validateOrigin(job.url, environment);
    const response = await request(job.url, {
      headers,
      redirect: 'error',
      signal: AbortSignal.timeout(options.timeoutMs ?? 20_000),
    });
    const retry = response.headers.get('retry-after');
    const retryAfterMs = retry
      ? /^\d+$/.test(retry)
        ? Number(retry) * 1000
        : Math.max(0, Date.parse(retry) - (options.now?.() ?? Date.now()))
      : undefined;
    const result: HttpResult = {
      status: response.status,
      bytes: 0,
      etag: response.headers.get('etag') ?? undefined,
      lastModified: response.headers.get('last-modified') ?? undefined,
      retryAfterMs: Number.isFinite(retryAfterMs) ? retryAfterMs : undefined,
    };
    if (response.status !== 200) {
      await response.body?.cancel();
      return result;
    }
    if (Number(response.headers.get('content-length')) > max) {
      await response.body?.cancel();
      throw Error('Resposta TSE excede limite de bytes');
    }
    const reader = response.body?.getReader();
    if (!reader) throw Error('Resposta TSE vazia');
    const chunks: Uint8Array[] = [];
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        result.bytes += value.length;
        if (result.bytes > max) throw Error('Resposta TSE excede limite de bytes');
        chunks.push(value);
      }
    } catch (error) {
      await reader.cancel();
      throw error;
    } finally {
      reader.releaseLock();
    }
    const raw = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
    const body = JSON.parse(raw);
    validatePhase(body.f, environment);
    const validated = options.validate(raw, job);
    return { ...result, raw, ...(validated ?? {}) };
  };
}
