import { describe, expect, it } from 'vitest'
import { fuzzySearch } from '../src/lib/fuzzy'
import type { SiteIndexEntry } from '../src/lib/types'

function entry(name: string, aliases: string[] = []): SiteIndexEntry {
  return { slug: name.toLowerCase().replace(/\s+/g, '-'), name, aliases, status: 'verified' }
}

const entries = [entry('Giant Mole'), entry('Kraken'), entry('King Black Dragon'), entry('Vorkath', ['vork'])]

describe('fuzzySearch', () => {
  it('returns everything, in order, for an empty query', () => {
    expect(fuzzySearch(entries, '').map((r) => r.entry.name)).toEqual(entries.map((e) => e.name))
  })

  it('ranks an exact substring match first', () => {
    const results = fuzzySearch(entries, 'kraken')
    expect(results[0]?.entry.name).toBe('Kraken')
  })

  it('matches case-insensitively', () => {
    expect(fuzzySearch(entries, 'GIANT').map((r) => r.entry.name)).toContain('Giant Mole')
  })

  it('matches an in-order subsequence even without a contiguous substring', () => {
    const results = fuzzySearch(entries, 'gmole')
    expect(results.map((r) => r.entry.name)).toContain('Giant Mole')
  })

  it('matches against an alias, not just the name', () => {
    const results = fuzzySearch(entries, 'vork')
    expect(results[0]?.entry.name).toBe('Vorkath')
  })

  it('excludes entries that match neither the name nor any alias', () => {
    const results = fuzzySearch(entries, 'xyzzy')
    expect(results).toEqual([])
  })
})
