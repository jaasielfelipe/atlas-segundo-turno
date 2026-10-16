import type { Environment } from '../../domain/src/index';
import { ea12Schema, ea20Schema } from './schemas';
import { digest, normalizeEA20, resolveTsePath, validatePhase, type PathContext } from './index';

export type Segment = { uf: string; municipality: string; zone: string };
export const segmentKey = (s: Segment) => `${s.uf}:${s.municipality}:${s.zone}`;
export const zoneKey = (s: Segment) => `${s.uf}:${s.zone}`;

/** EA12 must be a complete captured catalog, never a filtered watchlist. */
export function parseZoneRegistry(input: unknown, environment: Environment) {
  const catalog = ea12Schema.parse(input);
  validatePhase(catalog.f, environment);
  const segments: Segment[] = [],
    seen = new Set<string>(),
    municipalities = new Set<string>(),
    ufs = new Set<string>();
  for (const uf of catalog.abr) {
    if (ufs.has(uf.cd)) throw Error('UF duplicada');
    ufs.add(uf.cd);
    for (const m of uf.mu) {
      const mk = `${uf.cd}:${m.cd}`;
      if (municipalities.has(mk) || m.z.length === 0)
        throw Error('Cadastro municipal incompleto/duplicado');
      municipalities.add(mk);
      for (const zone of m.z) {
        const s = { uf: uf.cd, municipality: m.cd, zone },
          key = segmentKey(s);
        if (seen.has(key)) throw Error('Segmento duplicado');
        seen.add(key);
        segments.push(s);
      }
    }
  }
  if (!segments.length) throw Error('Cadastro vazio');
  return { digest: digest(input), segments };
}

export function normalizeZone(
  input: unknown,
  context: PathContext & {
    uf: string;
    municipality: string;
    zone: string;
    sourceUrl: string;
    capturedAt: string;
    registry: ReturnType<typeof parseZoneRegistry>;
    raw: string;
  },
) {
  if (context.officeCode !== '1') throw Error('Comparação presidencial apenas');
  if (context.sourceUrl !== resolveTsePath('EA20', context))
    throw Error('URL não corresponde ao segmento');
  if (!context.registry.segments.some((s) => segmentKey(s) === segmentKey(context)))
    throw Error('Segmento fora do cadastro');
  const j = ea20Schema.parse(input);
  const snapshot = normalizeEA20(input, {
    ...context,
    electionId: context.electionId,
    office: 'president',
    territory: {
      id: segmentKey(context),
      kind: 'municipality',
      name: '',
      uf: context.uf,
      tseCode: context.municipality,
      ibgeCode: null,
      parentId: context.uf,
    },
  });
  const destinations = snapshot.candidates.every((c) =>
    ['Válido', 'Anulado', 'Anulado sub judice'].includes(c.destination ?? ''),
  );
  const exceptional = Number(j.s.sni ?? 0) > 0 || Number(j.s.sna ?? 0) > 0;
  const complete = Number(j.s.ts) > 0 && j.s.st === j.s.ts && Number(j.s.snt) === 0;
  const annulled = snapshot.candidates
    .filter((c) => c.destination === 'Anulado')
    .reduce((n, c) => n + (c.countedVotes ?? 0), 0);
  const subJudice = snapshot.candidates
    .filter((c) => c.destination === 'Anulado sub judice')
    .reduce((n, c) => n + (c.countedVotes ?? 0), 0);
  const countsConsistent =
    (!complete ||
      (j.s.si !== undefined &&
        j.s.sni !== undefined &&
        Number(j.s.si) + Number(j.s.sni) === Number(j.s.ts))) &&
    annulled === Number(j.v.van) &&
    subJudice === Number(j.v.vansj);
  const status: 'complete' | 'partial' | 'needs_review' = !complete
    ? 'partial'
    : exceptional ||
        !countsConsistent ||
        !destinations ||
        snapshot.warnings.length ||
        j.dv !== 's' ||
        !snapshot.votes.valid
      ? 'needs_review'
      : 'complete';
  return {
    snapshot,
    /** Electorate and vote categories of the segment (null while not published). */
    counts: {
      electorate: snapshot.electorate.total,
      turnout: snapshot.electorate.turnout,
      valid: snapshot.votes.valid,
      blank: snapshot.votes.blank,
      null: snapshot.votes.null,
      annulled: snapshot.votes.annulled,
    },
    segment: { uf: context.uf, municipality: context.municipality, zone: context.zone },
    registryDigest: context.registry.digest,
    status,
    reason: exceptional ? 'Seções excepcionais exigem validação específica' : null,
    validCandidates: snapshot.candidates
      .filter((c) => c.destination === 'Válido')
      .map((c) => ({ id: c.id, votes: c.countedVotes! })),
  };
}
