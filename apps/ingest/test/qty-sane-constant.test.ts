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
 * `qty_sane` is the one VALIDATION_CHECKS entry that stays hardcoded
 * `{ ok: true }` in `apps/ingest/src/parse/parse-boss.ts` — audited and
 * left that way deliberately (see docs/DECISIONS.md), because every
 * `QtySpec` variant is fully bounded by `QtySpecSchema` at parse time with
 * no runtime-only case (unlike `rates_valid`'s `formula` rates, whose
 * numeric output the schema cannot see): `exact`/`range` require
 * non-negative integers with a `superRefine` enforcing `min <= max`, and
 * `choice` requires a non-empty array of non-negative integers.
 *
 * That claim is only true because the three-kind list below is the WHOLE
 * set. If a fourth `QtySpec` kind is ever added — a `formula`-driven
 * quantity, say — this test fails, which is the point: it's the trip wire
 * telling whoever adds it that `qty_sane`'s hardcoded `true` needs
 * re-auditing against the new kind, the same way `rates_valid` was audited
 * and found to need a real implementation for `formula` rates.
 */
describe('qty_sane hardcoded-true precondition', () => {
  it('QtySpec has exactly the three kinds qty_sane was audited against', () => {
    expect(discriminatorKinds(QtySpecSchema)).toEqual(['choice', 'exact', 'range'])
  })

  it('every kind rejects the shape of bad input that would make quantities insane', () => {
    // exact/range: negative or non-integer values
    expect(QtySpecSchema.safeParse({ kind: 'exact', n: -1 }).success).toBe(false)
    expect(QtySpecSchema.safeParse({ kind: 'exact', n: 1.5 }).success).toBe(false)
    expect(QtySpecSchema.safeParse({ kind: 'range', min: 5, max: 2 }).success).toBe(false)
    expect(QtySpecSchema.safeParse({ kind: 'range', min: -1, max: 2 }).success).toBe(false)
    // choice: empty array, or a negative value in it
    expect(QtySpecSchema.safeParse({ kind: 'choice', values: [] }).success).toBe(false)
    expect(QtySpecSchema.safeParse({ kind: 'choice', values: [1, -2] }).success).toBe(false)
  })
})
