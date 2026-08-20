import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import {
  BossSchema,
  DEFAULT_SIM_CONTEXT,
  SharedTableSchema,
  type Boss,
  type Table,
} from '@osrs-loot-simulator/loot-model'
import { SimContextControls } from '../src/components/SimContextControls'
import { DEFAULT_KILLS, DEFAULT_SEED, type SimRunParams } from '../src/lib/url-state'

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
      params={{ ctx: { ...DEFAULT_SIM_CONTEXT }, seed: DEFAULT_SEED, kills: DEFAULT_KILLS, run: false }}
      onChange={() => {}}
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

  it('Scorpia (Konar-eligible, has a Brimstone key drop) gets a Konar task toggle', () => {
    renderFor('scorpia')
    expect(screen.getByText('Konar task')).toBeDefined()
  })

  it('an ordinary boss is not cluttered with controls it ignores', () => {
    renderFor('brutus')
    expect(screen.queryByText('Delve level reached')).toBeNull()
    expect(screen.queryByText('MVP (most damage dealt)')).toBeNull()
    expect(screen.queryByText('Blood Moon')).toBeNull()
    // Brutus has no Brimstone key entry (not Konar-eligible), unlike Ring of
    // wealth, which is universal because it reaches the shared RDT/gem tables.
    expect(screen.queryByText('Konar task')).toBeNull()
    // The universal ones still render.
    expect(screen.getByText('Ring of wealth')).toBeDefined()
  })
})

/**
 * Every user is assumed to be a member, so there is no "Members" control
 * anywhere. Sources with a genuine free-to-play outcome get an inverted
 * "Free-to-play" toggle instead — see `BossContextSurface.freeToPlayVariant`
 * for why the signal is a `members: false` gate and not merely the presence of
 * a members condition.
 */
describe('the members toggle is retired in favour of a free-to-play one', () => {
  it('renders no Members toggle on any source, including the two that gate on it', () => {
    for (const slug of ['brutus', 'black-knight-titan', 'vorkath']) {
      cleanup()
      renderFor(slug)
      expect(screen.queryByText('Members'), slug).toBeNull()
    }
  })

  it('offers Free-to-play on Brutus, which really has an F2P table', () => {
    renderFor('brutus')
    expect(screen.getByText('Free-to-play')).toBeDefined()
  })

  it('does NOT offer it on Black Knight Titan, a members-only quest boss', () => {
    // Its lone members condition is `Key (medium)`, marked (m) on a page whose
    // infobox says `members = Yes`. Free players cannot reach the encounter, so
    // offering the toggle would present an unreachable game state as a choice.
    renderFor('black-knight-titan')
    expect(screen.queryByText('Free-to-play')).toBeNull()
  })

  it('does NOT offer it on a source with no members condition at all', () => {
    renderFor('vorkath')
    expect(screen.queryByText('Free-to-play')).toBeNull()
  })

  it('unchecked means members, checked sets members false', () => {
    const boss = loadBoss('brutus')
    const seen: SimRunParams[] = []
    render(
      <SimContextControls
        boss={boss}
        sharedTables={shared}
        params={{
          ctx: { ...DEFAULT_SIM_CONTEXT },
          seed: DEFAULT_SEED,
          kills: DEFAULT_KILLS,
          run: false,
        }}
        onChange={(p) => seen.push(p)}
      />
    )
    const toggle = screen.getByLabelText('Free-to-play', { selector: 'input' })
    // Default context is members: true, so the F2P box starts unchecked.
    expect((toggle as HTMLInputElement).checked).toBe(false)
    fireEvent.click(toggle)
    expect(seen).toHaveLength(1)
    expect(seen[0]!.ctx.members).toBe(false)
  })

  it('shows the box already checked for a context that arrived as F2P', () => {
    // This is the shared-link case: `?members=0` parses to members false, and
    // the control must reflect it whichever way round the label reads.
    const boss = loadBoss('brutus')
    render(
      <SimContextControls
        boss={boss}
        sharedTables={shared}
        params={{
          ctx: { ...DEFAULT_SIM_CONTEXT, members: false },
          seed: DEFAULT_SEED,
          kills: DEFAULT_KILLS,
          run: false,
        }}
        onChange={() => {}}
      />
    )
    const toggle = screen.getByLabelText('Free-to-play', { selector: 'input' })
    expect((toggle as HTMLInputElement).checked).toBe(true)
  })
})

/**
 * The redesign this file's own header comment doesn't yet mention: ownership
 * controls (Lunar Chest's 12 per-set pieces) used to be a `NumberField` per
 * item, labeled with the raw `itemKey` slug. They're chips now — real item
 * names, toggled by click, not typed — because every `ownershipGate` in the
 * corpus is a threshold of 1 ("own it or not"), which a number input was
 * offering false precision for. See `docs/DECISIONS.md`'s ownership-chip
 * entry for the full reasoning.
 */
describe('ownership controls render as toggleable chips, not number inputs', () => {
  it('labels a chip with the real item name, not the raw itemKey', () => {
    renderFor('lunar-chest')
    expect(screen.getByText('Blood moon helm')).toBeDefined()
    expect(screen.queryByText('blood-moon-helm')).toBeNull()
  })

  it('renders each owned-piece control as a button, not a number input', () => {
    renderFor('lunar-chest')
    const chip = screen.getByText('Blood moon helm').closest('button')
    expect(chip).not.toBeNull()
    expect(chip?.getAttribute('type')).toBe('button')
  })

  it('starts unpressed, and clicking sets ownedCounts to 1', () => {
    const boss = loadBoss('lunar-chest')
    const seen: SimRunParams[] = []
    render(
      <SimContextControls
        boss={boss}
        sharedTables={shared}
        params={{ ctx: { ...DEFAULT_SIM_CONTEXT }, seed: DEFAULT_SEED, kills: DEFAULT_KILLS, run: false }}
        onChange={(p) => seen.push(p)}
      />
    )
    const chip = screen.getByText('Blood moon helm').closest('button')!
    expect(chip.getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(chip)
    expect(seen).toHaveLength(1)
    expect(seen[0]!.ctx.ownedCounts['blood-moon-helm']).toBe(1)
  })

  it('clicking an already-owned chip clears it back to 0, not decrements it', () => {
    const boss = loadBoss('lunar-chest')
    const seen: SimRunParams[] = []
    render(
      <SimContextControls
        boss={boss}
        sharedTables={shared}
        params={{
          ctx: { ...DEFAULT_SIM_CONTEXT, ownedCounts: { 'blood-moon-helm': 1 } },
          seed: DEFAULT_SEED,
          kills: DEFAULT_KILLS,
          run: false,
        }}
        onChange={(p) => seen.push(p)}
      />
    )
    const chip = screen.getByText('Blood moon helm').closest('button')!
    expect(chip.getAttribute('aria-pressed')).toBe('true')

    fireEvent.click(chip)
    expect(seen[0]!.ctx.ownedCounts['blood-moon-helm']).toBe(0)
  })

  it('falls back to a labeled number input for an item whose gate needs more than own-or-not', () => {
    // No real source needs this today (every corpus gate is n:1 — see
    // `context-fields.test.ts`'s reconciliation tests), so this exercises the
    // fallback with a synthetic boss rather than waiting for one to exist.
    // It's the guarantee behind the design: an item doesn't lose precision
    // just because it happens to be rendered as a chip elsewhere.
    const boss = BossSchema.parse({
      slug: 'test-boss',
      name: 'Test Boss',
      wikiPage: 'Test Boss',
      wikiRevId: 1,
      status: 'verified',
      source: 'generated',
      parserVersion: 1,
      validation: { ok: true, checks: [] },
      tables: [
        {
          id: 't1',
          mode: 'weighted',
          denominator: 1,
          entries: [
            {
              node: {
                kind: 'item',
                itemId: 1,
                itemKey: 'rare-thing',
                name: 'Rare thing',
                qty: { kind: 'exact', n: 1 },
              },
              rate: { kind: 'weight', weight: 1 },
              ownershipGate: { itemKey: 'rare-thing', n: 3, when: 'atLeast' },
            },
          ],
        },
      ],
    })
    render(
      <SimContextControls
        boss={boss}
        sharedTables={shared}
        params={{ ctx: { ...DEFAULT_SIM_CONTEXT }, seed: DEFAULT_SEED, kills: DEFAULT_KILLS, run: false }}
        onChange={() => {}}
      />
    )
    // A number input, not a chip: no button wrapping the label.
    expect(screen.getByText('Rare thing').closest('button')).toBeNull()
    const input = screen.getByLabelText('Rare thing') as HTMLInputElement
    expect(input.type).toBe('number')
  })
})
