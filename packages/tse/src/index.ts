import { createHash } from 'node:crypto';
import {
  ratio,
  tseTimestamp,
  type Environment,
  type Office,
  type Round,
  type Snapshot,
  type Territory,
} from '../../domain/src/index';
import {
  ea11Schema,
  ea12Schema,
  ea14Schema,
  ea15Schema,
  ea16Schema,
  ea18Schema,
  ea20Schema,
  type ElectionConfig,
} from './schemas';
export * from './schemas';

export function validatePhase(phase: string, environment: Environment) {
  if (environment !== 'fixture' && phase !== (environment === 'official' ? 'o' : 's'))
    throw Error(`Fase ${phase} incompatível com ${environment}`);
}
export function validateOrigin(url: string, environment: Environment) {
  const u = new URL(url);
  if (environment === 'fixture') {
    if (u.protocol !== 'fixture:') throw Error('Fixture exige origem local');
    return;
  }
  const hostname =
    environment === 'official' ? 'resultados.tse.jus.br' : 'resultados-sim.tse.jus.br';
  const prefix = environment === 'official' ? '/oficial/' : '/simulado/simulado2026/';
  if (
    u.protocol !== 'https:' ||
    u.hostname !== hostname ||
    u.port ||
    u.username ||
    u.password ||
    !u.pathname.startsWith(prefix)
  )
    throw Error('Origem TSE inválida');
}
/**
 * Official pleitos observed in the EA11 (16/10/2026): 1st round 3220 on 04/10, 2nd round 3221 on
 * 25/10 (president election 6258). The simulated environment is discovered by round only.
 */
const OFFICIAL_PLEITO: Record<Round, { id: string; date: string }> = {
  '1': { id: '3220', date: '04/10/2026' },
  '2': { id: '3221', date: '25/10/2026' },
};
/** The single presidential election of `round` in the 2026 cycle; anything else fails. */
export function discoverElection(
  input: unknown,
  environment: 'official' | 'simulated',
  round: Round,
) {
  const config = ea11Schema.parse(input);
  validatePhase(config.f, environment);
  const officeCode = '1';
  const found = config.pl
    .filter((p) => p.c === 'ele2026')
    .flatMap((pleito) =>
      pleito.e
        .filter((e) => e.t === round && e.abr.some((a) => a.cp.some((c) => c.cd === officeCode)))
        .map((election) => ({ pleito, election })),
    );
  const expected = OFFICIAL_PLEITO[round];
  if (
    found.length !== 1 ||
    (environment === 'official' &&
      (found[0].pleito.cd !== expected.id || found[0].pleito.dt !== expected.date))
  )
    throw Error(`Configuração 2026 do ${round}º turno não confirmada`);
  const { pleito, election } = found[0];
  return {
    config,
    pleitoId: pleito.cd,
    cycle: pleito.c,
    electionId: election.cd,
    officeCode,
    round,
    environment,
  };
}
export type PathContext = ReturnType<typeof discoverElection> & {
  uf?: string;
  municipality?: string;
  zone?: string;
  section?: string;
};
const pad = (v: string | undefined, length: number) => {
  if (!v || !/^\d+$/.test(v) || v.length > length) throw Error('Identificador inválido para URL');
  return v.padStart(length, '0');
};
export function resolveTsePath(
  kind: 'EA12' | 'EA14' | 'EA15' | 'EA20' | 'EA16' | 'EA18',
  c: PathContext,
): string {
  const uf = kind === 'EA14' ? 'br' : (c.uf ?? 'br');
  if (
    !/^[a-z]{2}$/.test(uf) ||
    (c.officeCode === '3' && kind === 'EA20' && ['br', 'zz'].includes(uf))
  )
    throw Error('Abrangência incompatível');
  if (['EA15', 'EA16', 'EA18'].includes(kind) && uf === 'br') throw Error('UF obrigatória');
  const type = { EA12: 'cm', EA14: 'ab', EA15: 'ab', EA20: 'u', EA16: 'cs', EA18: 'aux' }[kind];
  const directories = c.config.arq.filter((a) => a.tp === type);
  if (directories.length !== 1) throw Error(`Diretório ${type} não descoberto no EA11`);
  const e = pad(c.electionId, 6),
    p = pad(c.pleitoId, 6),
    cargo = pad(c.officeCode, 4);
  const m = c.municipality ? pad(c.municipality, 5) : undefined;
  const z = c.zone ? pad(c.zone, 4) : undefined,
    s = c.section ? pad(c.section, 4) : undefined;
  if (kind === 'EA20' && z && (!m || uf === 'br')) throw Error('Zona exige município e UF');
  const values: Record<string, string | undefined> = {
    base:
      c.environment === 'official'
        ? 'https://resultados.tse.jus.br'
        : 'https://resultados-sim.tse.jus.br/simulado',
    ambiente: c.environment === 'official' ? 'oficial' : 'simulado2026',
    ciclo: c.cycle,
    cd_eleicao: c.electionId,
    cd_pleito: c.pleitoId,
    uf,
    municipio: m,
    zona: z,
    secao: s,
  };
  const directory = directories[0].dir.replace(/<([^>]+)>/g, (_, key: string) => {
    if (!values[key]) throw Error(`Token EA11 não resolvido: ${key}`);
    return values[key]!;
  });
  if (directory.includes('..') || directory.includes('\\')) throw Error('Diretório inválido');
  const filename = {
    EA12: `mun-e${e}-cm.json`,
    EA14: `br-e${e}-ab.json`,
    EA15: `${uf}-e${e}-ab.json`,
    EA20: `${uf}${m ?? ''}${z ? `-z${z}` : ''}-c${cargo}-e${e}-u.json`,
    EA16: `${uf}-p${p}-cs.json`,
    EA18: `p${p}-${uf}-m${m}-z${z}-s${s}-aux.json`,
  }[kind];
  const url = `${directory}/${filename}`;
  validateOrigin(url, c.environment);
  return url;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}
export const digest = (input: unknown) =>
  createHash('sha256').update(canonical(input)).digest('hex');
export const rawDigest = (raw: string) => createHash('sha256').update(raw).digest('hex');

export function normalizeEA20(
  input: unknown,
  context: {
    environment: Environment;
    electionId: string;
    round: Round;
    office: Office;
    territory: Territory;
    sourceUrl: string;
    capturedAt: string;
    basis?: 'ea20' | 'synthetic';
    raw?: string;
    zone?: string;
  },
): Snapshot {
  const j = ea20Schema.parse(input);
  validatePhase(j.f, context.environment);
  validateOrigin(context.sourceUrl, context.environment);
  const { territory, office } = context;
  const kind = context.zone
    ? 'zona'
    : territory.kind === 'municipality'
      ? 'mu'
      : territory.kind === 'exterior'
        ? 'uf'
        : territory.kind;
  const code = context.zone ?? territory.tseCode ?? territory.uf ?? 'br';
  if (context.zone && (!/^\d{4}$/.test(context.zone) || !territory.tseCode))
    throw Error('Identificação zonal inválida');
  if (j.ele !== context.electionId || j.t !== context.round || j.tpabr !== kind || j.cdabr !== code)
    throw Error('Eleição/turno/abrangência incompatível');
  if (office === 'governor' && ['br', 'exterior'].includes(territory.kind))
    throw Error('Governador exige UF');
  const cargo = j.carg.find((c) => c.cd === (office === 'president' ? '1' : '3'));
  if (!cargo || j.carg.length !== 1) throw Error('Cargo incompatível');
  if (
    !Number.isFinite(Date.parse(context.capturedAt)) ||
    new Date(context.capturedAt).toISOString() !== context.capturedAt
  )
    throw Error('Captura UTC inválida');
  const n = (v: string) => Number(v);
  if (
    n(j.s.st) > n(j.s.ts) ||
    n(j.s.st) + n(j.s.snt) !== n(j.s.ts) ||
    n(j.e.est) > n(j.e.te) ||
    n(j.e.esi) > n(j.e.est) ||
    n(j.e.c) + n(j.e.a) !== n(j.e.esi)
  )
    throw Error('Contadores de cobertura inconsistentes');
  if (
    n(j.v.vvc) !== n(j.v.vv) + n(j.v.van) + n(j.v.vansj) ||
    n(j.v.tv) !== n(j.v.vvc) + n(j.v.vb) + n(j.v.tvn) + n(j.v.vscv ?? '0')
  )
    throw Error('Categorias de votos inconsistentes');
  const publish = office !== 'president' || j.dv === 's';
  const candidates = cargo.agr.flatMap((a) =>
    a.par.flatMap((p) =>
      (p.cand ?? []).map((c) => ({
        id: c.sqcand,
        number: c.n,
        name: c.nmu,
        party: p.sg,
        destination: c.dvt || null,
        countedVotes: publish ? n(c.vap) : null,
        validShare: null as number | null,
      })),
    ),
  );
  if (new Set(candidates.map((c) => c.id)).size !== candidates.length)
    throw Error('Candidatura duplicada');
  const validCandidates = candidates.filter((c) => c.destination === 'Válido');
  const consistent =
    validCandidates.reduce((sum, c) => sum + (c.countedVotes ?? 0), 0) === n(j.v.vv);
  for (const c of validCandidates)
    c.validShare = publish && consistent ? ratio(c.countedVotes, n(j.v.vv)) : null;
  const contentDigest = digest(input);
  return {
    id: digest([
      context.environment,
      context.electionId,
      office,
      context.zone ? `${territory.id}:${context.zone}` : territory.id,
      contentDigest,
    ]),
    environment: context.environment,
    electionId: context.electionId,
    office,
    territoryId: territory.id,
    round: context.round,
    phase: j.f,
    basis: context.basis ?? 'ea20',
    capturedAt: context.capturedAt,
    sourceGeneratedAt: tseTimestamp(j.dg, j.hg),
    sourceTotalizedAt: j.dt && j.ht ? tseTimestamp(j.dt, j.ht) : null,
    sourceIdg: j.idg,
    sourceUrl: context.sourceUrl,
    digest: contentDigest,
    rawDigest: rawDigest(context.raw ?? JSON.stringify(input)),
    status: publish ? 'updated' : 'not_published',
    progress: j.and,
    finalTotalization: j.tf === 's',
    sections: { total: n(j.s.ts), totalized: n(j.s.st), share: ratio(n(j.s.st), n(j.s.ts)) },
    electorate: {
      total: n(j.e.te),
      totalized: n(j.e.est),
      installed: n(j.e.esi),
      turnout: n(j.e.c),
      share: ratio(n(j.e.est), n(j.e.te)),
      turnoutShare: ratio(n(j.e.c), n(j.e.esi)),
    },
    votes: {
      total: publish ? n(j.v.tv) : null,
      valid: publish ? n(j.v.vv) : null,
      toCandidates: publish ? n(j.v.vvc) : null,
      blank: publish ? n(j.v.vb) : null,
      null: publish ? n(j.v.tvn) : null,
      annulled: publish ? n(j.v.van) : null,
      subJudice: publish ? n(j.v.vansj) : null,
    },
    candidates,
    warnings: consistent
      ? []
      : ['Soma das candidaturas válidas difere de v.vv; participações indisponíveis'],
  };
}
export function parseCatalog(input: unknown, environment: Environment): Territory[] {
  const j = ea12Schema.parse(input);
  validatePhase(j.f, environment);
  const seen = new Set<string>(),
    ibge = new Set<string>();
  const territories: Territory[] = [
    {
      id: 'br',
      kind: 'br',
      name: 'Brasil',
      uf: null,
      tseCode: null,
      ibgeCode: null,
      parentId: null,
    },
  ];
  for (const a of j.abr) {
    territories.push({
      id: a.cd,
      kind: a.cd === 'zz' ? 'exterior' : 'uf',
      name: a.ds,
      uf: a.cd,
      tseCode: null,
      ibgeCode: null,
      parentId: 'br',
    });
    for (const m of a.mu) {
      const key = `${a.cd}:${m.cd}`;
      if (seen.has(key) || (m.cdi && ibge.has(m.cdi))) throw Error('Catálogo duplicado');
      seen.add(key);
      if (m.cdi) ibge.add(m.cdi);
      // DF is a single UF; exterior locations are not Brazilian municipalities.
      if (a.cd === 'df' || a.cd === 'zz') continue;
      territories.push({
        id: key,
        kind: 'municipality',
        name: m.nm,
        uf: a.cd,
        tseCode: m.cd,
        ibgeCode: m.cdi || null,
        parentId: a.cd,
      });
    }
  }
  return territories;
}
export function parseTracking(
  input: unknown,
  environment: Environment,
  electionId: string,
  round: Round,
  kind: 'EA14' | 'EA15',
) {
  const j = (kind === 'EA14' ? ea14Schema : ea15Schema).parse(input);
  validatePhase(j.f, environment);
  if (j.ele !== electionId || j.t !== round) throw Error('Acompanhamento incompatível');
  for (const a of j.abr) {
    const valid =
      kind === 'EA14'
        ? ['br', 'uf'].includes(a.tpabr) && /^[a-z]{2}$/.test(a.cdabr)
        : (a.tpabr === 'mun' && /^\d{5}$/.test(a.cdabr)) ||
          (a.tpabr === 'uf' && /^[a-z]{2}$/.test(a.cdabr));
    if (!valid) throw Error('Abrangência do acompanhamento inválida');
  }
  return j.abr.map((a) => ({
    code: a.cdabr,
    totalizedAt: a.dt && a.ht ? tseTimestamp(a.dt, a.ht) : null,
    sections: Number(a.s.st),
    // A hint only; never used to manufacture an EA20 snapshot.
    changeHint: digest([a.cdabr, a.dt, a.ht, a.s, a.e, a.and]),
  }));
}
export function parseSections(input: unknown, environment: Environment, pleitoId: string) {
  const j = ea16Schema.parse(input);
  validatePhase(j.f, environment);
  if (j.cdp !== pleitoId) throw Error('Pleito de seções incompatível');
  return j;
}
export function parseAuxiliary(input: unknown, environment: Environment) {
  const j = ea18Schema.parse(input);
  validatePhase(j.f, environment);
  return {
    ...j,
    availableFiles: j.hashes.flatMap((h) =>
      h.hash ? h.arq.map((a) => ({ ...a, hash: h.hash!, status: h.st ?? null })) : [],
    ),
    basis: 'available_files' as const,
  };
}
