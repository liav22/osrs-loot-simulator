import { BossSchema, DEFAULT_SIM_CONTEXT, type Boss, type BossInput, type SimContext } from '../src/index'

/** Minimal valid boss wrapper so tests can focus on the tables under test. */
export function makeBoss(tables: BossInput['tables'], overrides: Partial<BossInput> = {}): Boss {
  return BossSchema.parse({
    slug: 'test-boss',
    name: 'Test Boss',
    wikiPage: 'Test Boss',
    wikiRevId: 1,
    tables,
    status: 'verified',
    source: 'generated',
    parserVersion: 1,
    validation: { ok: true, checks: [] },
    ...overrides,
  })
}

export function ctxWith(overrides: Partial<SimContext> = {}): SimContext {
  return { ...DEFAULT_SIM_CONTEXT, ...overrides }
}

export function dropCount(
  drops: ReadonlyArray<{ itemId: number | null; drops: number }>,
  itemId: number | null
): number {
  return drops.find((drop) => drop.itemId === itemId)?.drops ?? 0
}

export function dropQuantity(
  drops: ReadonlyArray<{ itemId: number | null; quantity: number }>,
  itemId: number | null
): number {
  return drops.find((drop) => drop.itemId === itemId)?.quantity ?? 0
}
