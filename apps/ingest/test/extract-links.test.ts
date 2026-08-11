import { describe, expect, it } from 'vitest'
import { extractLinks, extractMainTargets } from '../src/inventory/build.js'

describe('extractMainTargets', () => {
  it('extracts the first positional param of a {{Main|...}} call', () => {
    expect(extractMainTargets('{{Main|Rewards Chest (Fortis Colosseum)}}')).toEqual([
      'Rewards Chest (Fortis Colosseum)',
    ])
  })

  it('takes only the first param when there are several', () => {
    expect(extractMainTargets('{{Main|Sol Heredit|Fortis Colosseum/Strategies#Sol Heredit}}')).toEqual([
      'Sol Heredit',
    ])
  })

  it('ignores a named parameter as the first param', () => {
    expect(extractMainTargets('{{Main|selfref=yes}}')).toEqual([])
  })

  it('finds multiple {{Main|...}} calls on one page', () => {
    const wikitext = 'prose {{Main|Page A}} more prose {{Main|Page B|extra}} end'
    expect(extractMainTargets(wikitext)).toEqual(['Page A', 'Page B'])
  })

  it('returns nothing when there is no Main template', () => {
    expect(extractMainTargets('just prose, no templates')).toEqual([])
  })
})

describe('extractLinks', () => {
  it('includes both wikilinks and {{Main|...}} targets', () => {
    const wikitext =
      '[[Fortis Colosseum]] is where Sol Heredit fights. {{Main|Rewards Chest (Fortis Colosseum)}}'
    const links = extractLinks(wikitext)
    expect(links).toContain('Fortis Colosseum')
    expect(links).toContain('Rewards Chest (Fortis Colosseum)')
  })

  it('deduplicates', () => {
    const wikitext = '[[Barrows]] [[Barrows]] {{Main|Barrows}}'
    expect(extractLinks(wikitext)).toEqual(['Barrows'])
  })
})
