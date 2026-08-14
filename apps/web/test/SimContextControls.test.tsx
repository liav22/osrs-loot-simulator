import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import {
  BossSchema,
  DEFAULT_SIM_CONTEXT,
  SharedTableSchema,
  type Boss,
  type Table,
} from '@osrs-loot-simulator/loot-model'
import { SimContextControls } from '../src/components/SimContextControls'
import { DEFAULT_KILLS, DEFAULT_SEED } from '../src/lib/url-state'

/**
 * Renders the real component against the real generated documents. The point
 * of this file is the specific complaint it answers: Doom of Mokhaiotl and
 * Lunar Chest were shipped and simulate-able, but had no control to reach
 * them by, so a typecheck passing said nothing about whether they were usable.
 */
const ROOT = join(__dirname, '..', '..', '..', 'data')

function loadBoss(slug: string): Boss {
  return BossSchema.parse(JSON.parse(readFileSync(join(ROOT, 'bosses', `${slug}.json`), 'utf8')))
}

const shared: Map<string, Table> = new Map(
  readdirSync(join(ROOT, 'tables'))
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const table = SharedTableSchema.parse(
        JSON.parse(readFileSync(join(ROOT, 'tables', f), 'utf8'))
      )
      return [table.id, table] as const
    })
)

function renderFor(slug: string) {
  const boss = loadBoss(slug)
  render(
    <SimContextControls
      boss={boss}
      sharedTables={shared}
      params={{ ctx: { ...DEFAULT_SIM_CONTEXT }, seed: DEFAULT_SEED, kills: DEFAULT_KILLS }}
      onChange={() => {}}
      onSimulate={() => {}}
      buttonState="idle"
    />
  )
}

describe('SimContextControls renders the controls each boss needs', () => {
  it('Doom of Mokhaiotl gets a delve level control', () => {
    renderFor('doom-of-mokhaiotl')
    expect(screen.getByText('Delve level reached')).toBeDefined()
  })

  it('Lunar Chest gets a Moon selector and owned-piece inputs', () => {
    renderFor('lunar-chest')
    expect(screen.getByText('Blood Moon')).toBeDefined()
    expect(screen.getByText('Blue Moon')).toBeDefined()
    expect(screen.getByText('Eclipse Moon')).toBeDefined()
    expect(screen.getByText(/Already owned entering the run/)).toBeDefined()
  })

  it('Zalcano gets both damage inputs and the MVP toggle', () => {
    renderFor('zalcano')
    expect(screen.getByText('Damage to hitpoints')).toBeDefined()
    expect(screen.getByText('Damage to shield')).toBeDefined()
    expect(screen.getByText('MVP (most damage dealt)')).toBeDefined()
  })

  it('an ordinary boss is not cluttered with controls it ignores', () => {
    renderFor('brutus')
    expect(screen.queryByText('Delve level reached')).toBeNull()
    expect(screen.queryByText('MVP (most damage dealt)')).toBeNull()
    expect(screen.queryByText('Blood Moon')).toBeNull()
    // The universal ones still render.
    expect(screen.getByText('Members')).toBeDefined()
  })
})
