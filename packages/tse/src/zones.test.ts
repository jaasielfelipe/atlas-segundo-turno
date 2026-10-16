import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, it } from 'vitest';
import { discoverElection, rawDigest, resolveTsePath } from './index';
import { normalizeZone, parseZoneRegistry } from './zones';
const read = (p: string) => readFileSync(resolve('packages/fixtures', p), 'utf8');
const json = (p: string) => JSON.parse(read(p));
const observations = json('zonal/observation.json') as {
  file: string;
  url: string;
  environment: 'simulated' | 'official';
  capturedAt: string;
  sha256: string;
}[];
function sample(file: string) {
  const o = observations.find((o) => o.file === file)!;
  const context = discoverElection(
    json(`${o.environment === 'simulated' ? 'simulado' : 'official'}/ea11.json`),
    o.environment,
    '1',
  );
  const registry = parseZoneRegistry(
    json(o.environment === 'simulated' ? 'simulado/ea12.json' : 'zonal/official-ea12.json'),
    o.environment,
  );
  const [, uf, municipality, zone] = file.match(/-(\w{2})(\d{5})-z(\d{4})/) ?? [];
  return {
    raw: read(`zonal/${file}`),
    context: {
      ...context,
      uf,
      municipality,
      zone,
      registry,
      sourceUrl: o.url,
      capturedAt: o.capturedAt,
      raw: read(`zonal/${file}`),
    },
  };
}
it('preserva hashes dos seis downloads e cadastro multissegmento', () => {
  observations.forEach((o) => expect(rawDigest(read(`zonal/${o.file}`))).toBe(o.sha256));
  const { context } = sample('sim-ac01120-z0008.json');
  expect(
    context.registry.segments
      .filter((s) => s.uf === 'ac' && s.zone === '0008')
      .map((s) => s.municipality)
      .sort(),
  ).toEqual(['01120', '01511', '01538']);
});
it('normaliza três segmentos concluídos do simulado e vincula URL exata', () => {
  let valid = 0;
  for (const m of ['01120', '01511', '01538']) {
    const { raw, context } = sample(`sim-ac${m}-z0008.json`);
    expect(resolveTsePath('EA20', context)).toBe(context.sourceUrl);
    const r = normalizeZone(JSON.parse(raw), context);
    expect(r.status).toBe('complete');
    valid += r.snapshot.votes.valid!;
    expect(() => normalizeZone(JSON.parse(raw), { ...context, municipality: '01023' })).toThrow(
      'URL',
    );
  }
  expect(valid).toBe(26703);
});
it('exceção não instalada fica em revisão; oficial sem totalização fica parcial', () => {
  const ba = sample('sim-ba35572-z0153.json');
  expect(normalizeZone(JSON.parse(ba.raw), ba.context).status).toBe('needs_review');
  const official = sample('official-ac01120-z0008.json');
  expect(normalizeZone(JSON.parse(official.raw), official.context).status).toBe('partial');
  expect(() => normalizeZone({ ...JSON.parse(official.raw), f: 's' }, official.context)).toThrow(
    'Fase',
  );
});
