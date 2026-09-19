import { describe, expect, it } from 'vitest'
import { BossSchema } from '@osrs-loot-simulator/loot-model'
import { attemptLabelFor, capitalizeLabel } from '../src/lib/attempt-label'

function boss(attemptLabel?: { singular: string; plural: string }) {
  return BossSchema.parse({
    slug: 'source',
    name: 'Source',
    wikiPage: 'Source',
    wikiRevId: 1,
    tables: [],
    status: 'verified',
    source: 'generated',
    parserVersion: 1,
    validation: { ok: true, checks: [] },
    ...(attemptLabel === undefined ? {} : { attemptLabel }),
  })
}

describe('attemptLabelFor', () => {
  it('defaults combat sources to kills', () => {
    expect(attemptLabelFor(boss())).toEqual({ singular: 'kill', plural: 'kills' })
  })

  it('uses source-specific non-combat terminology', () => {
    expect(
      attemptLabelFor(
        boss({ singular: 'successful pickpocket', plural: 'successful pickpockets' })
      )
    ).toEqual({ singular: 'successful pickpocket', plural: 'successful pickpockets' })
    expect(capitalizeLabel('successful pickpockets')).toBe('Successful pickpockets')
  })
})
