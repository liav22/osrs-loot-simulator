import { readFile } from 'node:fs/promises'
import type { WikiClient } from '../wiki/client.js'
import { slugify, writeSnapshot } from '../snapshots/store.js'
import { InventorySchema } from './schema.js'
import { INVENTORY_PATH } from './build.js'

/**
 * Spot-checks the pages excluded as `no-loot-data`.
 *
 * That bucket is meant to hold hub and meta pages — `Boss kill count`,
 * `Dagannoth Kings` — which are not monsters at all. A page there that carries
 * an `infobox_monster` row with a real combat level is a fightable monster we
 * dropped on the floor, and needs a human decision rather than a silent
 * exclusion.
 */

export interface AuditRow {
  slug: string
  title: string
  isMonster: boolean
  combatLevel: number | null
  hitpoints: number | null
  suspicious: boolean
}

export async function auditExclusions(
  client: WikiClient,
  log: (message: string) => void
): Promise<AuditRow[]> {
  const inventory = InventorySchema.parse(JSON.parse(await readFile(INVENTORY_PATH, 'utf8')))
  const excluded = inventory.bosses.filter((boss) => boss.classification === 'no-loot-data')

  log(`Auditing ${excluded.length} pages excluded as no-loot-data\n`)
  const rows: AuditRow[] = []

  for (const boss of excluded) {
    const { rows: monsterRows, record } = await client.monsterInfo(boss.title)
    await writeSnapshot('monster', slugify(boss.title), record)

    // A page can carry several infobox versions; take the strongest signal.
    const combatLevels = monsterRows
      .map((row) => row.combatLevel)
      .filter((level): level is number => level !== null)
    const hitpoints = monsterRows
      .map((row) => row.hitpoints)
      .filter((value): value is number => value !== null)

    const combatLevel = combatLevels.length > 0 ? Math.max(...combatLevels) : null
    const isMonster = monsterRows.length > 0
    const suspicious = isMonster && combatLevel !== null && combatLevel > 0

    rows.push({
      slug: boss.slug,
      title: boss.title,
      isMonster,
      combatLevel,
      hitpoints: hitpoints.length > 0 ? Math.max(...hitpoints) : null,
      suspicious,
    })
  }

  return rows.sort(
    (a, b) => Number(b.suspicious) - Number(a.suspicious) || (b.combatLevel ?? 0) - (a.combatLevel ?? 0)
  )
}
