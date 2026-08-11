import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { WikiClient } from '../wiki/client.js'
import { BucketResponseSchema } from '../wiki/schemas.js'
import {
  REPO_ROOT,
  listSnapshots,
  readManifest,
  readSnapshot,
  slugify,
  writeSnapshot,
} from '../snapshots/store.js'
import { classify, type TriageResult } from '../triage/classify.js'
import {
  INCLUDED_CLASSIFICATIONS,
  INVENTORY_VERSION,
  InventorySchema,
  type BossEntry,
  type Classification,
  type Inventory,
  type LootSource,
} from './schema.js'

/**
 * Reclassifies the page inventory into loot sources (PROJECT_PLAN.md 6.1).
 *
 * Tier E is not one thing. Splitting it needs a signal for "is this page part
 * of a bigger encounter", and that signal is taken from the wiki, never from
 * memory: a shared category counts as an encounter only when the page of the
 * same name carries an `infobox_activity` row. That distinguishes Chambers of
 * Xeric from a category like "Content released in 2007" or a quest name, both
 * of which are also shared by several boss pages.
 */

export const INVENTORY_PATH = join(REPO_ROOT, 'data', '_inventory.json')

/** Links worth testing as an encounter's reward page. */
const REWARD_LINK = /chest|reward|loot|casket/i

/** A category needs this many tier-E members before it is worth testing. */
const MIN_ENCOUNTER_MEMBERS = 2

function extractLinks(wikitext: string): string[] {
  const links: string[] = []
  for (const match of wikitext.matchAll(/\[\[([^\]|#]+)/g)) {
    const target = match[1]?.trim()
    if (target !== undefined && target !== '') links.push(target)
  }
  return [...new Set(links)]
}

async function triageFor(slug: string, title: string): Promise<TriageResult> {
  const snapshot = await readSnapshot('dropsline', slug)
  const response = BucketResponseSchema.parse(snapshot.body)
  return classify({
    title,
    slug,
    rawRows: response.bucket ?? [],
    bucketError: response.error ?? null,
  })
}

export interface BuildOptions {
  log: (message: string) => void
}

export async function buildInventory(
  client: WikiClient,
  options: BuildOptions
): Promise<Inventory> {
  const { log } = options
  const manifest = await readManifest()

  log('Triaging snapshots already on disk')
  const triage = new Map<string, TriageResult>()
  for (const entry of manifest.entries) {
    triage.set(entry.title, await triageFor(entry.slug, entry.title))
  }
  const tierE = new Set(
    [...triage.values()].filter((result) => result.tier === 'E').map((result) => result.title)
  )
  log(`  ${triage.size} pages, ${tierE.size} in tier E\n`)

  log('Categories for every inventory page')
  const titles = manifest.entries.map((entry) => entry.title)
  const { categories, records: categoryRecords } = await client.categoriesFor(titles)
  for (const [index, record] of categoryRecords.entries()) {
    await writeSnapshot('categories', `batch-${index}`, record)
  }

  const byCategory = new Map<string, string[]>()
  for (const [title, names] of categories) {
    for (const name of names) {
      const members = byCategory.get(name) ?? []
      members.push(title)
      byCategory.set(name, members)
    }
  }
  const candidates = [...byCategory.entries()]
    .filter(([, members]) => members.filter((m) => tierE.has(m)).length >= MIN_ENCOUNTER_MEMBERS)
    .map(([name]) => name)
    .sort()
  log(`  ${byCategory.size} categories, ${candidates.length} worth testing as encounters\n`)

  log('Testing candidates for an infobox_activity row')
  const encounters = new Set<string>()
  for (const candidate of candidates) {
    const { activity, record } = await client.isActivity(candidate)
    await writeSnapshot('activity', slugify(candidate), record)
    if (activity) {
      encounters.add(candidate)
      log(`  encounter: ${candidate}`)
    }
  }
  log(`  ${encounters.size} encounters confirmed\n`)

  // Reward pages are discovered per page, not per encounter. The Moons of
  // Peril bosses are categorised under the dungeon they live in rather than
  // the activity, so an encounter-only search misses their Lunar Chest
  // entirely; their own pages link it directly.
  log('Reading tier-E pages for links to a reward container')
  const rewardCandidates = new Map<string, string[]>()
  const encounterTitles = [...encounters].sort()
  for (const title of [...tierE, ...encounterTitles].sort()) {
    const { wikitext, record } = await client.wikitext(title)
    await writeSnapshot('wikitext', slugify(title), record)
    rewardCandidates.set(title, extractLinks(wikitext).filter((link) => REWARD_LINK.test(link)))
  }
  const distinct = new Set<string>()
  for (const links of rewardCandidates.values()) for (const link of links) distinct.add(link)
  for (const encounter of encounterTitles) distinct.add(encounter)
  log(`  ${distinct.size} distinct candidate pages to test\n`)

  log('Testing candidates for drop rows')
  /** Candidate link -> row count and the wiki's canonical page name. */
  const candidateRows = new Map<string, { rowCount: number; canonical: string }>()
  const onDisk = new Set(await listSnapshots('dropsline'))
  for (const candidate of [...distinct].sort()) {
    const slug = slugify(candidate)

    // Snapshot-first (6.3): re-read from disk rather than re-hitting the wiki.
    let response
    if (onDisk.has(slug)) {
      response = BucketResponseSchema.parse((await readSnapshot('dropsline', slug)).body)
    } else {
      const fetched = await client.dropsFor(candidate)
      await writeSnapshot('dropsline', slug, fetched.record)
      onDisk.add(slug)
      response = fetched.response
    }

    const rows = response.bucket ?? []
    // Wikitext link targets are case-insensitive on the first letter, so
    // `[[reward pool]]` is a legitimate link to "Reward pool". Take the
    // canonical name from the data rather than from the link text.
    const first = rows[0]
    const canonical =
      typeof first?.['page_name'] === 'string' ? (first['page_name'] as string) : candidate
    candidateRows.set(candidate, { rowCount: rows.length, canonical })
    if (rows.length > 0) log(`  ${canonical} — ${rows.length} rows`)
  }
  log('')

  /** First candidate with drop rows, checked page-first then encounter. */
  const rewardPageFor = (
    title: string,
    encounter: string | null
  ): { title: string; slug: string; rowCount: number } | null => {
    const ordered = [
      ...(rewardCandidates.get(title) ?? []),
      ...(encounter === null ? [] : [encounter, ...(rewardCandidates.get(encounter) ?? [])]),
    ]
    for (const candidate of ordered) {
      if (candidate === title) continue
      const hit = candidateRows.get(candidate)
      if (hit !== undefined && hit.rowCount > 0) {
        return { title: hit.canonical, slug: slugify(hit.canonical), rowCount: hit.rowCount }
      }
    }
    return null
  }

  // ---------------------------------------------------------------------
  // Classify every page and fold it into a loot source.
  // ---------------------------------------------------------------------

  const encounterFor = (title: string): string | null => {
    for (const name of categories.get(title) ?? []) {
      if (encounters.has(name)) return name
    }
    return null
  }

  const bosses: BossEntry[] = []
  const sources = new Map<string, LootSource>()

  const upsertSource = (
    id: string,
    source: Omit<LootSource, 'bosses'>,
    bossSlug: string
  ): void => {
    const existing = sources.get(id)
    if (existing === undefined) sources.set(id, { ...source, bosses: [bossSlug] })
    else existing.bosses.push(bossSlug)
  }

  for (const entry of manifest.entries) {
    const result = triage.get(entry.title)
    if (result === undefined) continue
    const encounter = result.tier === 'E' ? encounterFor(entry.title) : null

    let classification: Classification
    let sourceId: string
    let sourceTitle: string
    let dropsPage: string
    let sourceTier = result.tier
    let sourceRows = result.rowCount
    let excludeReason: string | null = null

    const reward = result.tier === 'E' ? rewardPageFor(entry.title, encounter) : null

    if (result.tier !== 'E') {
      classification = 'own-table'
      sourceId = entry.slug
      sourceTitle = entry.title
      dropsPage = entry.title
    } else if (reward !== null) {
      classification = 'reward-page'
      sourceId = reward.slug
      sourceTitle = encounter ?? reward.title
      dropsPage = reward.title
      const rewardTriage = await triageFor(reward.slug, reward.title)
      sourceTier = rewardTriage.tier
      sourceRows = rewardTriage.rowCount
    } else if (encounter !== null) {
      classification = 'component'
      sourceId = slugify(encounter)
      sourceTitle = encounter
      dropsPage = encounter
      sourceRows = 0
      excludeReason = `component of ${encounter}, which has no drop rows on any page — point-based rewards belong in an override`
    } else if (result.rowCount > 0) {
      classification = 'trivial'
      sourceId = entry.slug
      sourceTitle = entry.title
      dropsPage = entry.title
    } else {
      classification = 'no-loot-data'
      sourceId = entry.slug
      sourceTitle = entry.title
      dropsPage = entry.title
      excludeReason = 'no drop rows, no encounter, no reward page'
    }

    bosses.push({
      slug: entry.slug,
      title: entry.title,
      pageid: entry.pageid,
      revid: entry.revid,
      lootSourceId: sourceId,
      classification,
      tier: result.tier,
      rowCount: result.rowCount,
      encounter,
    })

    upsertSource(
      sourceId,
      {
        id: sourceId,
        title: sourceTitle,
        dropsPage,
        tier: sourceTier,
        rowCount: sourceRows,
        include: INCLUDED_CLASSIFICATIONS.includes(classification),
        excludeReason,
      },
      entry.slug
    )
  }

  const inventory = InventorySchema.parse({
    inventoryVersion: INVENTORY_VERSION,
    generatedAt: new Date().toISOString(),
    category: manifest.category,
    bosses: bosses.sort((a, b) => a.slug.localeCompare(b.slug)),
    lootSources: [...sources.values()].sort((a, b) => a.id.localeCompare(b.id)),
  })

  await writeFile(INVENTORY_PATH, `${JSON.stringify(inventory, null, 2)}\n`, 'utf8')
  return inventory
}
