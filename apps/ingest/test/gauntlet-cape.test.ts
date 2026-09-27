import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  BossSchema,
  DEFAULT_SIM_CONTEXT,
  simulate,
  type Boss,
  type SimContext,
} from '@osrs-loot-simulator/loot-model'
import { REPO_ROOT } from '../src/snapshots/store.js'

const CAPE_KEY = 'gauntlet-cape'

async function loadBoss(): Promise<Boss> {
  const raw = JSON.parse(
    await readFile(join(REPO_ROOT, 'data', 'bosses', 'reward-chest-the-gauntlet.json'), 'utf8')
  )
  return BossSchema.parse(raw)
}

const corruptedContext = (ownedCounts: SimContext['ownedCounts'] = {}): SimContext => ({
  ...DEFAULT_SIM_CONTEXT,
  variant: 'Corrupted',
  ownedCounts,
})

describe('Corrupted Gauntlet cape', () => {
  it('is represented as the wiki-stated not-already-owned reward', async () => {
    const boss = await loadBoss()
    const cape = boss.tables
      .flatMap((table) => table.entries)
      .find((entry) => entry.node.kind === 'item' && entry.node.itemKey === CAPE_KEY)

    expect(cape?.rate).toEqual({ kind: 'always' })
    expect(cape?.conditions).toEqual([{ kind: 'variant', name: 'Corrupted' }])
    expect(cape?.ownershipGate).toEqual({ itemKey: CAPE_KEY, n: 1, when: 'below' })
  })

  it('awards exactly one cape across repeated completions', async () => {
    const boss = await loadBoss()
    const result = simulate(boss, 100, corruptedContext(), 27)
    const cape = result.drops.find((drop) => drop.itemKey === CAPE_KEY)

    expect(cape?.drops).toBe(1)
    expect(cape?.quantity).toBe(1)
  })

  it('awards no cape when the player already owns one', async () => {
    const boss = await loadBoss()
    const result = simulate(boss, 100, corruptedContext({ [CAPE_KEY]: 1 }), 27)
    const cape = result.drops.find((drop) => drop.itemKey === CAPE_KEY)

    expect(cape?.drops).toBe(0)
    expect(cape?.quantity).toBe(0)
  })
})
