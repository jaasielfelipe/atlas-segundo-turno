import { z } from 'zod';

export const id = z.string().regex(/^\d+$/);
const count = id.refine(
  (v) => Number.isSafeInteger(Number(v)),
  'Contagem fora do intervalo seguro',
);
const date = z.string().regex(/^\d{2}\/\d{2}\/\d{4}$/);
const time = z.string().regex(/^\d{2}:\d{2}:\d{2}$/);
const meta = { dg: date, hg: time, idg: id, f: z.enum(['s', 'o']) };
const municipalityId = z.string().regex(/^\d{5}$/);
const sectionId = z.string().regex(/^\d{4}$/);
const uf = z.string().regex(/^[a-z]{2}$/);
export const ea11Schema = z
  .object({
    ...meta,
    arq: z.array(z.object({ tp: z.string(), dir: z.string().min(1) }).passthrough()),
    pl: z.array(
      z
        .object({
          cd: id,
          c: z.string(),
          dt: date,
          e: z.array(
            z
              .object({
                cd: id,
                t: z.enum(['1', '2']),
                nm: z.string(),
                cdt2: z.string().optional(),
                abr: z.array(
                  z
                    .object({
                      cd: uf,
                      cp: z.array(z.object({ cd: id, ds: z.string() }).passthrough()),
                    })
                    .passthrough(),
                ),
              })
              .passthrough(),
          ),
        })
        .passthrough(),
    ),
  })
  .passthrough();
export const ea12Schema = z
  .object({
    ...meta,
    abr: z.array(
      z
        .object({
          cd: uf,
          ds: z.string(),
          mu: z.array(
            z
              .object({
                cd: municipalityId,
                cdi: z.union([z.literal(''), z.string().regex(/^\d{7}$/)]),
                nm: z.string(),
                z: z.array(sectionId),
              })
              .passthrough(),
          ),
        })
        .passthrough(),
    ),
  })
  .passthrough();
const sections = z
  .object({
    ts: count,
    st: count,
    snt: count,
    si: count.optional(),
    sni: count.optional(),
    sa: count.optional(),
    sna: count.optional(),
  })
  .passthrough();
const electorate = z
  .object({ te: count, est: count, esi: count, c: count, a: count })
  .passthrough();
const trackingRow = z
  .object({
    tpabr: z.string(),
    cdabr: z.string(),
    and: z.enum(['n', 'p', 'f']),
    dt: z.string(),
    ht: z.string(),
    s: sections,
    e: electorate,
  })
  .passthrough();
export const ea14Schema = z
  .object({ ...meta, ele: id, t: z.enum(['1', '2']), abr: z.array(trackingRow) })
  .passthrough();
export const ea15Schema = ea14Schema;
export const ea20Schema = z
  .object({
    ...meta,
    ele: id,
    t: z.enum(['1', '2']),
    tpabr: z.enum(['br', 'uf', 'mu', 'zona']),
    cdabr: z.string(),
    dt: z.string(),
    ht: z.string(),
    dv: z.enum(['s', 'n']),
    tf: z.enum(['s', 'n']),
    and: z.enum(['n', 'p', 'f']),
    s: sections,
    e: electorate,
    v: z
      .object({
        tv: count,
        vvc: count,
        vv: count,
        vb: count,
        tvn: count,
        van: count,
        vansj: count,
        vscv: count.optional(),
      })
      .passthrough(),
    carg: z
      .array(
        z
          .object({
            cd: id,
            agr: z.array(
              z
                .object({
                  par: z.array(
                    z
                      .object({
                        sg: z.string(),
                        cand: z
                          .array(
                            z
                              .object({
                                n: id,
                                sqcand: id,
                                nm: z.string(),
                                nmu: z.string(),
                                dvt: z.string().optional(),
                                vap: count,
                              })
                              .passthrough(),
                          )
                          .optional(),
                      })
                      .passthrough(),
                  ),
                })
                .passthrough(),
            ),
          })
          .passthrough(),
      )
      .min(1),
  })
  .passthrough();
export const ea16Schema = z
  .object({
    ...meta,
    cdp: id,
    abr: z.array(
      z
        .object({
          cd: uf,
          mu: z.array(
            z
              .object({
                cd: municipalityId,
                zon: z.array(
                  z
                    .object({
                      cd: sectionId,
                      sec: z.array(
                        z
                          .object({
                            ns: sectionId,
                            nsp: sectionId.optional(),
                            nsa: z.array(sectionId).optional(),
                            da: date.optional(),
                            ha: time.optional(),
                          })
                          .passthrough(),
                      ),
                    })
                    .passthrough(),
                ),
              })
              .passthrough(),
          ),
        })
        .passthrough(),
    ),
  })
  .passthrough();
// Observed EA18 contains an empty arq and omits hash/dr/hr/st. Availability is not implied.
export const ea18Schema = z
  .object({
    ...meta,
    st: z.string(),
    hashes: z.array(
      z
        .object({
          hash: z.string().optional(),
          dr: date.optional(),
          hr: time.optional(),
          st: z.string().optional(),
          arq: z.array(z.object({ nm: z.string(), tp: z.string() }).passthrough()),
        })
        .passthrough(),
    ),
  })
  .passthrough();
export type ElectionConfig = z.infer<typeof ea11Schema>;
