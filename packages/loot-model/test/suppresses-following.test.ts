import { describe, expect, it } from 'vitest'
import { BossSchema, expectedValue, simulate, type BossInput, type Table } from '../src/index'
import { ctxWith, dropCount, makeBoss } from './helpers'

/**
 * `Table.suppressesFollowing` — CoX's Ancient chest shape. Its unique table
 * rolls up to six uniques *independently* (multiple can hit in one raid), but
 * a hit anywhere in it replaces the player's entire chest, suppressing the
 * common table. Neither existing mode expresses that: `preroll` would discard
 * unique rolls 2–6, plain `independent` suppresses nothing.
 *
 * The fixture below is CoX's shape at toy probabilities, chosen so every
 * expectation is an exact fraction rather than a curve fit:
 *
 *   uniques   independent, suppressesFollowing, two entries at 1/2 each
 *   common    weighted, denominator 2, two entries at weight 1
 *   tertiary  independent, one entry at 1/2  (must NOT be suppressed)
 *   bonus     always, one entry               (must NOT be suppressed)
 *
 *   P(no unique)  = (1/2)(1/2) = 1/4
 *   E[common_i]   = 1/4 x 1/2  = 1/8
 *   E[unique_i]   = 1/2                 (unchanged by the flag)
 *   E[tertiary]   = 1/2                 (independent, out of the chain)
 *   E[bonus]      = 1                   (always, out of the chain)
 */

const UNIQUE_A = 1
const UNIQUE_B = 2
const COMMON_C = 3
const COMMON_D = 4
const TERTIARY_E = 5
const BONUS_F = 6

function item(itemId: number, itemKey: string) {
  return { kind: 'item', itemId, itemKey, name: itemKey, qty: { kind: 'exact', n: 1 } } as const
}

const half = { kind: 'fixed', num: 1, den: 2 } as const
const always = { kind: 'always' } as const

const commonTable: BossInput['tables'][number] = {
  id: 'common',
  mode: 'weighted',
  denominator: 2,
  entries: [
    { node: item(COMMON_C, 'common-c'), rate: { kind: 'weight', weight: 1 } },
    { node: item(COMMON_D, 'common-d'), rate: { kind: 'weight', weight: 1 } },
  ],
}

const tertiaryTable: BossInput['tables'][number] = {
  id: 'tertiary',
  mode: 'independent',
  entries: [{ node: item(TERTIARY_E, 'tertiary-e'), rate: half }],
}

const bonusTable: BossInput['tables'][number] = {
  id: 'bonus',
  mode: 'always',
  entries: [{ node: item(BONUS_F, 'bonus-f'), rate: always }],
}

/** `undefined` leaves the flag off the document entirely — the control case. */
function coxShapedBoss(suppressesFollowing: boolean | undefined) {
  const uniques: BossInput['tables'][number] = {
    id: 'uniques',
    mode: 'independent',
    entries: [
      { node: item(UNIQUE_A, 'unique-a'), rate: half },
      { node: item(UNIQUE_B, 'unique-b'), rate: half },
    ],
  }
  if (suppressesFollowing !== undefined) uniques.suppressesFollowing = suppressesFollowing
  return makeBoss([uniques, commonTable, tertiaryTable, bonusTable])
}

const ctx = ctxWith()

function expectedDrops(result: ReturnType<typeof expectedValue>, itemId: number): number {
  return result.items.find((i) => i.itemId === itemId)?.expectedDrops ?? 0
}

describe('suppressesFollowing: analytic expectation', () => {
  it('scales the following weighted table by P(no hit), leaving the table itself untouched', () => {
    const result = expectedValue(coxShapedBoss(true), ctx)

    // The uniques themselves are not affected by their own flag.
    expect(expectedDrops(result, UNIQUE_A)).toBeCloseTo(0.5, 12)
    expect(expectedDrops(result, UNIQUE_B)).toBeCloseTo(0.5, 12)
    // P(no unique) = 1/4, then the common table's own 1/2 split.
    expect(expectedDrops(result, COMMON_C)).toBeCloseTo(0.125, 12)
    expect(expectedDrops(result, COMMON_D)).toBeCloseTo(0.125, 12)
  })

  it('does not suppress independent or always tables — the same modes a preroll leaves alone', () => {
    const result = expectedValue(coxShapedBoss(true), ctx)
    expect(expectedDrops(result, TERTIARY_E)).toBeCloseTo(0.5, 12)
    expect(expectedDrops(result, BONUS_F)).toBeCloseTo(1, 12)
  })

  it('is inert when absent: the common table keeps its full, unsuppressed rate', () => {
    const result = expectedValue(coxShapedBoss(undefined), ctx)
    expect(expectedDrops(result, COMMON_C)).toBeCloseTo(0.5, 12)
    expect(expectedDrops(result, UNIQUE_A)).toBeCloseTo(0.5, 12)
  })
})

describe('suppressesFollowing: simulate agrees with the analytic path', () => {
  const n = 400_000

  it('observed common-table rate matches the suppressed expectation', () => {
    const result = simulate(coxShapedBoss(true), n, ctx, 7)
    // 1/8 expected; the standard error over 400k kills is ~5.2e-4, so these
    // bands are many sigma wide and cannot pass by luck.
    expect(dropCount(result.drops, COMMON_C) / n).toBeCloseTo(0.125, 2)
    expect(dropCount(result.drops, UNIQUE_A) / n).toBeCloseTo(0.5, 2)
    expect(dropCount(result.drops, TERTIARY_E) / n).toBeCloseTo(0.5, 2)
    expect(dropCount(result.drops, BONUS_F)).toBe(n)
  })

  it('turning the flag off measurably restores the common table, in the right direction', () => {
    const on = simulate(coxShapedBoss(true), n, ctx, 7)
    const off = simulate(coxShapedBoss(undefined), n, ctx, 7)
    expect(dropCount(off.drops, COMMON_C)).toBeGreaterThan(dropCount(on.drops, COMMON_C) * 3)
    // ...and only the common table's RATE moved. Not its count, and not the
    // uniques' counts either: suppressing the common table means it consumes
    // no RNG draw that kill, so the two runs' seeded streams diverge after the
    // first suppressed kill. Same-seed byte-equality is the wrong assertion
    // here (it fails, by ~0.05%); equal rates is the real claim.
    expect(dropCount(on.drops, UNIQUE_A) / n).toBeCloseTo(0.5, 2)
    expect(dropCount(off.drops, UNIQUE_A) / n).toBeCloseTo(0.5, 2)
  })
})

describe('suppressesFollowing: the thing preroll cannot do', () => {
  it('lets several entries hit in one kill while still suppressing the chain', () => {
    const result = simulate(coxShapedBoss(true), 1_000, ctx, 3, { logLimit: 1_000 })

    const bothUniques = result.log.filter(
      (kill) =>
        kill.drops.some((d) => d.itemId === UNIQUE_A) &&
        kill.drops.some((d) => d.itemId === UNIQUE_B)
    )
    // P(both) = 1/4, so ~250 of 1,000 logged kills. A preroll table with these
    // rates could never produce a single such kill — precisely why CoX needed
    // a new flag rather than a mode reassignment.
    expect(bothUniques.length).toBeGreaterThan(150)

    // No kill may show a unique and a common drop together.
    const contradictions = result.log.filter(
      (kill) =>
        kill.drops.some((d) => d.itemId === UNIQUE_A || d.itemId === UNIQUE_B) &&
        kill.drops.some((d) => d.itemId === COMMON_C || d.itemId === COMMON_D)
    )
    expect(contradictions).toEqual([])
  })

  it("a hit does not stop the suppressing table's own remaining rolls", () => {
    // Two rolls of a table whose single entry always hits: without the
    // deliberate "no break" in simulate.ts's independent case, this would
    // record one drop per kill instead of two.
    const boss = makeBoss([
      {
        id: 'twice',
        mode: 'independent',
        rolls: 2,
        suppressesFollowing: true,
        entries: [{ node: item(UNIQUE_A, 'unique-a'), rate: always }],
      },
    ])

    const result = simulate(boss, 1_000, ctx, 5)
    expect(result.drops.find((d) => d.itemId === UNIQUE_A)?.quantity).toBe(2_000)
    expect(expectedDrops(expectedValue(boss, ctx), UNIQUE_A)).toBeCloseTo(2, 12)
  })
})

describe("suppressesFollowing: a nested table's chain stays local", () => {
  // Phase 1's rule (docs/DECISIONS.md): a preroll hit inside a tableRef does
  // not suppress the parent document. The new trigger must inherit that, or
  // referencing a shared table would silently gut the referencing boss.
  const nested: Table = {
    id: 'nested-uniques',
    mode: 'independent',
    rolls: 1,
    withoutReplacement: false,
    suppressesFollowing: true,
    entries: [{ node: item(UNIQUE_A, 'unique-a'), rate: always }],
  }

  const boss = makeBoss([
    {
      id: 'access',
      mode: 'independent',
      entries: [{ node: { kind: 'tableRef', ref: 'nested-uniques' }, rate: always }],
    },
    commonTable,
  ])

  const tables = new Map([['nested-uniques', nested]])

  it('does not suppress the parent document', () => {
    const result = simulate(boss, 1_000, ctx, 11, { tables })
    expect(dropCount(result.drops, UNIQUE_A)).toBe(1_000)
    // The common table is untouched: every kill still draws from it.
    expect(dropCount(result.drops, COMMON_C) + dropCount(result.drops, COMMON_D)).toBe(1_000)
  })

  it('analytic path agrees', () => {
    const result = expectedValue(boss, ctx, { tables })
    expect(expectedDrops(result, COMMON_C)).toBeCloseTo(0.5, 12)
  })
})

describe('suppressesFollowing: schema', () => {
  const base = {
    slug: 'test-boss',
    name: 'Test Boss',
    wikiPage: 'Test Boss',
    wikiRevId: 1,
    status: 'verified',
    source: 'generated',
    parserVersion: 1,
    validation: { ok: true, checks: [] },
  }

  it('rejects the flag on every mode but independent', () => {
    const rejected = [
      { id: 't', mode: 'always', suppressesFollowing: true, entries: [{ node: item(1, 'a'), rate: always }] },
      {
        id: 't',
        mode: 'weighted',
        denominator: 2,
        suppressesFollowing: true,
        entries: [{ node: item(1, 'a'), rate: { kind: 'weight', weight: 1 } }],
      },
      { id: 't', mode: 'preroll', suppressesFollowing: true, entries: [{ node: item(1, 'a'), rate: half }] },
    ]
    for (const table of rejected) {
      expect(BossSchema.safeParse({ ...base, tables: [table] }).success).toBe(false)
    }
  })

  it('accepts it on independent, and leaves it absent when not set', () => {
    const withFlag = BossSchema.safeParse({
      ...base,
      tables: [
        { id: 't', mode: 'independent', suppressesFollowing: true, entries: [{ node: item(1, 'a'), rate: half }] },
      ],
    })
    expect(withFlag.success).toBe(true)

    // Optional, not `.default(false)` — a defaulted field would be written
    // into all 53 generated boss docs on the next re-parse, for a feature one
    // source will ever use.
    const without = BossSchema.parse({
      ...base,
      tables: [{ id: 't', mode: 'independent', entries: [{ node: item(1, 'a'), rate: half }] }],
    })
    expect(without.tables[0]).not.toHaveProperty('suppressesFollowing')
  })
})
