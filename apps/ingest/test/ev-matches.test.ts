import { describe, expect, it } from 'vitest'
import { checkEvMatches, extractAverageKillValue } from '../src/validate/ev-matches.js'
import { gePriceLookup } from '../src/prices/ge-prices.js'
import { BossSchema, DEFAULT_SIM_CONTEXT, TableSchema } from '@osrs-loot-simulator/loot-model'

describe('extractAverageKillValue', () => {
  it('extracts the figure from a rendered "average ... kill is worth N" sentence', () => {
    const html = '<p>The average Brutus (Members) kill is worth 597.57.</p>'
    expect(extractAverageKillValue(html)).toBe(597.57)
  })

  it('handles a comma-grouped value', () => {
    const html = '<p>The average Zulrah kill is worth 1,234.56.</p>'
    expect(extractAverageKillValue(html)).toBe(1234.56)
  })

  it('returns null when there is no such sentence', () => {
    expect(extractAverageKillValue('<p>Nothing relevant here.</p>')).toBeNull()
  })
})

const boss = BossSchema.parse({
  slug: 'test',
  name: 'Test',
  wikiPage: 'Test',
  wikiRevId: 1,
  status: 'needs_review',
  source: 'generated',
  parserVersion: 1,
  validation: { ok: true, checks: [] },
  tables: [
    {
      id: 't',
      mode: 'always',
      entries: [
        {
          node: { kind: 'item', itemId: 1, itemKey: 'a', name: 'A', qty: { kind: 'exact', n: 1 } },
          rate: { kind: 'always' },
        },
      ],
    },
  ],
})

describe('checkEvMatches', () => {
  it('fails with no rendered HTML available', () => {
    const result = checkEvMatches(boss, DEFAULT_SIM_CONTEXT, gePriceLookup(new Map()), null)
    expect(result.ok).toBe(false)
    expect(result.detail).toMatch(/no rendered page snapshot/)
  })

  it('fails when the rendered HTML has no average-value sentence', () => {
    const result = checkEvMatches(boss, DEFAULT_SIM_CONTEXT, gePriceLookup(new Map()), '<p>nothing</p>')
    expect(result.ok).toBe(false)
    expect(result.detail).toMatch(/no "average/)
  })

  it('passes within 2% and reports the computed and wiki figures', () => {
    const prices = new Map([[1, 100]])
    const html = '<p>The average Test kill is worth 100.5.</p>'
    const result = checkEvMatches(boss, DEFAULT_SIM_CONTEXT, gePriceLookup(prices), html)
    expect(result.ok).toBe(true)
    expect(result.gpPerKill).toBe(100)
    expect(result.wikiValue).toBe(100.5)
  })

  it('fails outside 2%', () => {
    const prices = new Map([[1, 50]])
    const html = '<p>The average Test kill is worth 100.</p>'
    const result = checkEvMatches(boss, DEFAULT_SIM_CONTEXT, gePriceLookup(prices), html)
    expect(result.ok).toBe(false)
    expect(result.detail).toMatch(/50\.0% off/)
  })

  // A boss reaching a shared table (rare_drop_table and friends) compiles its
  // own tables into a `tableRef` node — `compileBoss` throws
  // `UnresolvedTableRefError` unless the referenced table is supplied. This
  // check's own `expectedValue` call used to omit it entirely, which was
  // invisible in practice because `renderedHtml` is null for the vast
  // majority of the corpus (bulk `fetch --all` never populates the page-HTML
  // snapshot ev_matches needs) — the crash only surfaced once a source was
  // fetched with `fetch --page`, which does. See docs/DECISIONS.md.
  it('resolves a tableRef against the shared tables passed in, instead of throwing', () => {
    const bossWithRef = BossSchema.parse({
      ...boss,
      tables: [
        {
          id: 't',
          mode: 'always',
          entries: [
            { node: { kind: 'tableRef', ref: 'shared' }, rate: { kind: 'always' } },
          ],
        },
      ],
    })
    const shared = TableSchema.parse({
      id: 'shared',
      mode: 'always',
      entries: [
        {
          node: { kind: 'item', itemId: 1, itemKey: 'a', name: 'A', qty: { kind: 'exact', n: 1 } },
          rate: { kind: 'always' },
        },
      ],
    })
    const prices = new Map([[1, 100]])
    const html = '<p>The average Test kill is worth 100.</p>'
    const result = checkEvMatches(
      bossWithRef,
      DEFAULT_SIM_CONTEXT,
      gePriceLookup(prices),
      html,
      new Map([['shared', shared]])
    )
    expect(result.ok).toBe(true)
    expect(result.gpPerKill).toBe(100)
  })
})

describe('gePriceLookup', () => {
  it('prices a null itemId at 0', () => {
    expect(gePriceLookup(new Map([[1, 999]]))(null)).toBe(0)
  })

  it('prices an item absent from the GE data at 0 (untradeable, gemw=no)', () => {
    expect(gePriceLookup(new Map())(33115)).toBe(0)
  })

  it('returns the mapped price for a resolved id', () => {
    expect(gePriceLookup(new Map([[995, 1]]))(995)).toBe(1)
  })
})
