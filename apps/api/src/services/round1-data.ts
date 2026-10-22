import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';

/**
 * 1st-round data published as a GitHub Release (`dados-1t-v1`): files derived from the official
 * TSE acervo of 04/10/2026 that are not in git. Both hashes live here, in the repository, so a
 * download is accepted only if it is byte-for-byte what was published.
 */
export const ROUND1_RELEASE =
  'https://github.com/jaasielfelipe/atlas-segundo-turno/releases/download/dados-1t-v1';
export const ROUND1_FILES = [
  {
    /** Baseline: 1st-round votes per município–zona (ghosts, “vs 1º turno”, ΔT1). */
    target: 'data/baseline/round1.sqlite',
    asset: 'round1.sqlite.gz',
    gzipSha256: '10fef3ee5f13e6b3460eec32e3671b72512450559192aa901a52a03a46ca5f7e',
    sha256: '119f30247bd2c8d6718d6b6be7acaf359cc487b75e4e77a216d17f1b285db669',
  },
  {
    /** Replay of the 1st-round night, used only by `/telao?demo`. */
    target: 'apps/web/public/dev/replay-round1.json',
    asset: 'replay-round1.json.gz',
    gzipSha256: '8e55dad7c3399d6b30b5ec4474a42eb8c6c1837d2a45d37c308fcfc0a877f920',
    sha256: '863c8c72a393da04877dd255a96b2f37e28f6176348a0f77b15434d544232c2f',
  },
] as const;
export type Round1File = { target: string; asset: string; gzipSha256: string; sha256: string };

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** Checks the downloaded .gz and its content against the published hashes; returns the content. */
export function unpackVerified(gz: Uint8Array, file: Round1File) {
  if (sha256(gz) !== file.gzipSha256) throw Error(`${file.asset}: hash do download não confere`);
  const content = gunzipSync(gz);
  if (sha256(content) !== file.sha256) throw Error(`${file.asset}: hash do conteúdo não confere`);
  return content;
}

/** The file is already in place with the published content. */
export function installed(file: Round1File, root = process.cwd()) {
  const path = resolve(root, file.target);
  return existsSync(path) && sha256(readFileSync(path)) === file.sha256;
}

/**
 * Downloads, verifies and installs each file (written to a temporary name, then renamed). A file
 * already in place with other content is never overwritten: it may be a newer local build.
 */
export async function fetchRound1Data(
  root = process.cwd(),
  fetcher: typeof fetch = fetch,
  files: readonly Round1File[] = ROUND1_FILES,
  base = ROUND1_RELEASE,
) {
  const outcome: { target: string; result: 'installed' | 'present' }[] = [];
  for (const file of files) {
    const path = resolve(root, file.target);
    if (installed(file, root)) {
      outcome.push({ target: file.target, result: 'present' });
      continue;
    }
    if (existsSync(path))
      throw Error(`${file.target} já existe com outro conteúdo; mova-o antes de baixar.`);
    const response = await fetcher(`${base}/${file.asset}`);
    if (!response.ok) throw Error(`${file.asset}: HTTP ${response.status}`);
    const content = unpackVerified(new Uint8Array(await response.arrayBuffer()), file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(`${path}.download`, content);
    renameSync(`${path}.download`, path);
    outcome.push({ target: file.target, result: 'installed' });
  }
  return outcome;
}
