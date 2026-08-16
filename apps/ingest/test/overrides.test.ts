import { describe, expect, it } from 'vitest'
import { BossSchema, type BossInput } from '@osrs-loot-simulator/loot-model'
import {
  BossOverrideSchema,
  applyOverride,
  overrideSummary,
  type BossOverride,
} from '../src/parse/overrides.js'

/**
 * The override mechanism (PROJECT_PLAN.md 3 / 16's Phase 5, docs/OVERRIDES.md).
 * Merge semantics only — the parse-pipeline wiring is exercised by
 * `ingest parse` itself, which is verified to be byte-for-byte inert while
 * `data/overrides/` is empty.
 */

const NOTE = 'Authored because the wiki states this mechanic in prose, not in any DropsLine row.'

function generated(): BossInput {
  return {
    slug: 'test-source',
    name: 'Generated Name',
    aliases: ['gen'],
    wikiPage: 'Test Source',
    wikiRevId: 111,
    variants: ['normal'],
    tables: [
      {
        id: 'generated:main',
        mode: 'weighted',
        denominator: 2,
        entries: [
          {
            node: { kind: 'item', itemId: 1, itemKey: 'a', name: 'a', qty: { kind: 'exact', n: 1 } },
            rate: { kind: 'weight', weight: 1 },
          },
        ],
      },
    ],
    contextDefaults: {},
    status: 'needs_review',
    validation: { ok: false, checks: [] },
    source: 'generated',
    parserVersion: 7,
  }
}

const overrideTables: BossOverride['tables'] = [
  BossSchema.parse({
    ...generated(),
    tables: [
      {
        id: 'override:uniques',
        mode: 'independent',
        entries: [
          {
            node: { kind: 'item', itemId: 9, itemKey: 'z', name: 'z', qty: { kind: 'exact', n: 1 } },
            rate: { kind: 'fixed', num: 1, den: 100 },
          },
        ],
      },
    ],
  }).tables[0]!,
]

describe('BossOverrideSchema', () => {
  const valid = { slug: 'test-source', note: NOTE }

  it('requires a substantial note', () => {
    expect(BossOverrideSchema.safeParse(valid).success).toBe(true)
    expect(BossOverrideSchema.safeParse({ slug: 'test-source', note: 'fix' }).success).toBe(false)
    expect(BossOverrideSchema.safeParse({ slug: 'test-source' }).success).toBe(false)
  })

  it('rejects unknown keys rather than ignoring them', () => {
    // A typo in an override must fail loudly — silently dropping it would
    // leave the author believing a field took effect.
    const typo = BossOverrideSchema.safeParse({ ...valid, tabels: [] })
    expect(typo.success).toBe(false)
  })

  it('enforces kebab-case slugs', () => {
    expect(BossOverrideSchema.safeParse({ ...valid, slug: 'Test_Source' }).success).toBe(false)
  })
})

describe('applyOverride: merging over a generated document', () => {
  it("replaces tables wholesale and marks the result 'merged'", () => {
    const merged = BossSchema.parse(
      applyOverride(generated(), { slug: 'test-source', note: NOTE, tables: overrideTables }, 7, true)
    )
    expect(merged.source).toBe('merged')
    expect(merged.tables).toHaveLength(1)
    expect(merged.tables[0]?.id).toBe('override:uniques')
    // The generated table is GONE, not merged alongside — a stale table
    // surviving a rename is the failure mode wholesale replacement prevents.
    expect(merged.tables.some((t) => t.id === 'generated:main')).toBe(false)
    // Untouched fields are inherited.
    expect(merged.name).toBe('Generated Name')
    expect(merged.wikiRevId).toBe(111)
    expect(merged.parserVersion).toBe(7)
  })

  it('overrides only the metadata fields it actually declares', () => {
    const merged = BossSchema.parse(
      applyOverride(generated(), { slug: 'test-source', note: NOTE, name: 'Hand Authored' }, 7, true)
    )
    expect(merged.name).toBe('Hand Authored')
    expect(merged.aliases).toEqual(['gen'])
    // No tables declared: the generated ones survive.
    expect(merged.tables[0]?.id).toBe('generated:main')
    expect(merged.source).toBe('merged')
  })
})

describe('applyOverride: standing in for a document that never parsed', () => {
  it("marks the result 'override' and requires the fields it cannot inherit", () => {
    const full = BossSchema.parse(
      applyOverride(null, {
        slug: 'test-source',
        note: NOTE,
        name: 'Ancient chest',
        wikiPage: 'Ancient chest',
        wikiRevId: 15295333,
        tables: overrideTables,
      }, 7, true)
    )
    expect(full.source).toBe('override')
    expect(full.name).toBe('Ancient chest')
    expect(full.tables[0]?.id).toBe('override:uniques')
  })

  it('fails loudly when a required field is missing, naming every one', () => {
    expect(() => applyOverride(null, { slug: 'test-source', note: NOTE }, 7, true)).toThrow(
      /must supply name, wikiPage, wikiRevId, tables/
    )
    expect(() =>
      applyOverride(
        null,
        { slug: 'test-source', note: NOTE, name: 'x', tables: overrideTables },
        7,
        true
      )
    ).toThrow(/wikiPage, wikiRevId/)
  })
})

describe('overrideSummary', () => {
  it('records provenance for the parse report', () => {
    expect(overrideSummary({ slug: 's', note: NOTE, tables: overrideTables }, true)).toContain(
      'override applied (merged, 1 table(s))'
    )
    expect(overrideSummary({ slug: 's', note: NOTE }, false)).toContain(
      'override applied (override, metadata only)'
    )
  })
})
