import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { QtySpecSchema } from '@osrs-loot-simulator/loot-model'

/**
 * `QtySpecSchema` is `z.discriminatedUnion(...).superRefine(...)`, so the
 * public schema is a `ZodEffects` wrapper — `optionsMap` lives on the inner
 * `ZodDiscriminatedUnion`, reached via `._def.schema` (zod's own, if
 * underscore-prefixed, PUBLIC field for this — not a private/internal hack).
 */
function discriminatorKinds(schema: z.ZodTypeAny): string[] {
  const inner = (schema as z.ZodEffects<z.ZodTypeAny>)._def.schema as z.ZodDiscriminatedUnion<
    string,
    z.ZodDiscriminatedUnionOption<string>[]
  >
  return [...inner.optionsMap.keys()].map(String).sort()
}

/**
 * This trip wire fired exactly as designed: docs/mechanics-model-proposal.md's
 * Extension A added `QtySpec`'s fourth kind, `formula` — a quantity whose
 * numeric value only exists once evaluated against a `SimContext`, the same
 * shape of gap `rates_valid` already had a real implementation for. `qty_sane`
 * is no longer hardcoded `true`; `apps/ingest/src/validate/qty-sane.ts` now
 * evaluates `formula`-kind quantities (and `Table.rolls`/`qtyMultiplier`
 * formulas, added by the same change) the way `checkRatesValid` evaluates
 * `formula`-kind rates. See `qty-sane.test.ts` for that check's own coverage.
 */
describe('QtySpec kind precondition', () => {
  it('QtySpec has exactly the four kinds qty_sane is audited against', () => {
    expect(discriminatorKinds(QtySpecSchema)).toEqual(['choice', 'exact', 'formula', 'range'])
  })

  it('every schema-enforced kind still rejects the shape of bad input that would make quantities insane', () => {
    // exact/range: negative or non-integer values
    expect(QtySpecSchema.safeParse({ kind: 'exact', n: -1 }).success).toBe(false)
    expect(QtySpecSchema.safeParse({ kind: 'exact', n: 1.5 }).success).toBe(false)
    expect(QtySpecSchema.safeParse({ kind: 'range', min: 5, max: 2 }).success).toBe(false)
    expect(QtySpecSchema.safeParse({ kind: 'range', min: -1, max: 2 }).success).toBe(false)
    // choice: empty array, or a negative value in it
    expect(QtySpecSchema.safeParse({ kind: 'choice', values: [] }).success).toBe(false)
    expect(QtySpecSchema.safeParse({ kind: 'choice', values: [1, -2] }).success).toBe(false)
    // formula: the schema can only check its shape, not its eventual output —
    // that's exactly why qty-sane.ts evaluates it at ingest time instead.
    expect(QtySpecSchema.safeParse({ kind: 'formula', id: 'zalcano_points' }).success).toBe(true)
    expect(QtySpecSchema.safeParse({ kind: 'formula', id: 'not-a-real-id' }).success).toBe(false)
  })
})
