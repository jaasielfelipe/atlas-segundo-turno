import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { fetchRound1Data, unpackVerified } from './round1-data';

const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const content = Buffer.from('dados do 1º turno');
const gz = gzipSync(content);
const file = {
  target: 'data/baseline/x.sqlite',
  asset: 'x.sqlite.gz',
  gzipSha256: sha256(gz),
  sha256: sha256(content),
};

it('dados do 1º turno: só instala o que confere com os hashes publicados', async () => {
  expect(unpackVerified(gz, file)).toEqual(content);
  expect(() => unpackVerified(gzipSync(Buffer.from('outro')), file)).toThrow(/download/);
  expect(() => unpackVerified(gz, { ...file, sha256: '0'.repeat(64) })).toThrow(/conteúdo/);

  const root = mkdtempSync(join(tmpdir(), 'atlas-1t-'));
  try {
    let requests = 0;
    const fetcher = (async (url: string) => {
      requests++;
      expect(url).toBe('https://exemplo/x.sqlite.gz');
      return new Response(gz);
    }) as typeof fetch;
    expect(await fetchRound1Data(root, fetcher, [file], 'https://exemplo')).toEqual([
      { target: file.target, result: 'installed' },
    ]);
    expect(readFileSync(join(root, file.target))).toEqual(content);
    // Already in place: no request.
    expect(await fetchRound1Data(root, fetcher, [file], 'https://exemplo')).toEqual([
      { target: file.target, result: 'present' },
    ]);
    expect(requests).toBe(1);
    // A different local file is never overwritten.
    writeFileSync(join(root, file.target), 'base local mais nova');
    await expect(fetchRound1Data(root, fetcher, [file], 'https://exemplo')).rejects.toThrow(
      /já existe/,
    );
    // A tampered download is refused and nothing is written.
    const other = mkdtempSync(join(tmpdir(), 'atlas-1t-'));
    mkdirSync(join(other, 'data'), { recursive: true });
    const tampered = (async () => new Response(gzipSync(Buffer.from('x')))) as typeof fetch;
    await expect(fetchRound1Data(other, tampered, [file], 'https://exemplo')).rejects.toThrow(
      /hash/,
    );
    rmSync(other, { recursive: true, force: true });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
