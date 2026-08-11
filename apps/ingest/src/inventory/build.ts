import { z } from 'zod'
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

/**
 * A category needs this many tier-E members before it is worth testing —
 * EXCEPT a category whose name is also something a tier-E page links to
 * directly (see `linkedCategoryNames` in `buildInventory`), which waives this
 * entirely. Sol Heredit is the only tier-E page in "Fortis Colosseum", so the
 * category alone never clears this bar — but he links the page
 * `[[Fortis Colosseum]]` directly, which is what the waiver catches.
 */
const MIN_ENCOUNTER_MEMBERS = 2

/**
 * `{{Main|Target}}` / `{{Main|Target|...}}` is as strong a "this is the
 * related page" signal as a wikilink for this pipeline's purposes, and it is
 * how Fortis Colosseum itself points at its reward page:
 * `{{Main|Rewards Chest (Fortis Colosseum)}}`. A plain `[[...]]` scan misses
 * it entirely, since it is a template call, not a wikilink.
 */
export function extractMainTargets(wikitext: string): string[] {
  const targets: string[] = []
  for (const match of wikitext.matchAll(/\{\{\s*Main\s*\|([^{}]+?)\}\}/gi)) {
    const params = (match[1] ?? '').split('|')
    const first = params[0]?.trim()
    if (first !== undefined && first !== '' && !first.includes('=')) targets.push(first)
  }
  return targets
}

export function extractLinks(wikitext: string): string[] {
  const links: string[] = []
  for (const match of wikitext.matchAll(/\[\[([^\]|#]+)/g)) {
    const target = match[1]?.trim()
    if (target !== undefined && target !== '') links.push(target)
  }
  links.push(...extractMainTargets(wikitext))
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

  // Fetched up front, not after encounter detection: deciding which
  // categories are even worth testing (below) needs to know what each tier-E
  // page links to, not just what category it sits in. This is also the
  // wikitext the later reward-container scan reads, cached here so nothing
  // is fetched twice.
  log("Reading tier-E pages' own wikitext")
  const wikitextCache = new Map<string, string>()
  const onDiskWikitext = new Set(await listSnapshots('wikitext'))
  for (const title of [...tierE].sort()) {
    const slug = slugify(title)
    if (onDiskWikitext.has(slug)) {
      const snapshot = z
        .object({ parse: z.object({ wikitext: z.string() }).passthrough() })
        .parse((await readSnapshot('wikitext', slug)).body)
      wikitextCache.set(title, snapshot.parse.wikitext)
    } else {
      const { wikitext, record } = await client.wikitext(title)
      await writeSnapshot('wikitext', slug, record)
      wikitextCache.set(title, wikitext)
      onDiskWikitext.add(slug)
    }
  }
  log(`  ${wikitextCache.size} pages read\n`)

  const tierELinks = new Map<string, Set<string>>()
  for (const [title, wikitext] of wikitextCache) tierELinks.set(title, new Set(extractLinks(wikitext)))

  /**
   * Category names that are ALSO something a tier-E page links to directly
   * (a `[[...]]` wikilink or a `{{Main|...}}` target). Sol Heredit is the
   * only tier-E page in category "Fortis Colosseum" — never enough to clear
   * `MIN_ENCOUNTER_MEMBERS` on its own — but his own page links
   * `[[Fortis Colosseum]]` directly, which puts it here and waives the
   * member-count bar entirely; `isActivityCached` below still has the final
   * say on whether it is actually an encounter.
   */
  const linkedCategoryNames = new Set<string>()
  for (const links of tierELinks.values()) {
    for (const link of links) if (byCategory.has(link)) linkedCategoryNames.add(link)
  }

  const candidates = [...byCategory.entries()]
    .filter(
      ([name, members]) =>
        members.filter((m) => tierE.has(m)).length >= MIN_ENCOUNTER_MEMBERS ||
        linkedCategoryNames.has(name)
    )
    .map(([name]) => name)
    .sort()
  log(
    `  ${byCategory.size} categories, ${candidates.length} worth testing as encounters ` +
      `(${linkedCategoryNames.size} added by the MIN_ENCOUNTER_MEMBERS waiver)\n`
  )

  /** Snapshot-first `infobox_activity` lookup, so re-runs cost no requests. */
  const activityCache = new Map<string, boolean>()
  const activitySnapshots = new Set(await listSnapshots('activity'))
  const isActivityCached = async (page: string): Promise<boolean> => {
    const cached = activityCache.get(page)
    if (cached !== undefined) return cached
    const slug = slugify(page)
    let activity: boolean
    if (activitySnapshots.has(slug)) {
      const parsed = BucketResponseSchema.parse((await readSnapshot('activity', slug)).body)
      activity = (parsed.bucket?.length ?? 0) > 0
    } else {
      const fetched = await client.isActivity(page)
      await writeSnapshot('activity', slug, fetched.record)
      activitySnapshots.add(slug)
      activity = fetched.activity
    }
    activityCache.set(page, activity)
    return activity
  }

  log('Testing candidates for an infobox_activity row')
  const encounters = new Set<string>()
  for (const candidate of candidates) {
    if (await isActivityCached(candidate)) {
      encounters.add(candidate)
      log(`  encounter: ${candidate}${linkedCategoryNames.has(candidate) ? ' (waived)' : ''}`)
    }
  }
  log(`  ${encounters.size} encounters confirmed\n`)

  // Reward pages are discovered per page, not per encounter. The Moons of
  // Peril bosses are categorised under the dungeon they live in rather than
  // the activity, so an encounter-only search misses their Lunar Chest
  // entirely; their own pages link it directly. `{{Main|...}}` is included in
  // `extractLinks` too — Fortis Colosseum points at its own reward page via
  // `{{Main|Rewards Chest (Fortis Colosseum)}}`, not a wikilink.
  log('Reading tier-E pages for links to a reward container')
  const rewardCandidates = new Map<string, string[]>()
  const encounterTitles = [...encounters].sort()
  for (const title of [...tierE, ...encounterTitles].sort()) {
    let wikitext = wikitextCache.get(title)
    if (wikitext === undefined) {
      const fetched = await client.wikitext(title)
      wikitext = fetched.wikitext
      await writeSnapshot('wikitext', slugify(title), fetched.record)
      wikitextCache.set(title, wikitext)
    }
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

  /**
   * Every link on each tier-E page plus every confirmed encounter, for the
   * sibling pass below. `wikitextCache` already holds all of it — tier-E
   * pages from the up-front read, encounter titles from the reward scan —
   * so this costs no extra requests.
   */
  const allLinks = new Map<string, Set<string>>()
  for (const [title, wikitext] of wikitextCache) allLinks.set(title, new Set(extractLinks(wikitext)))

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

  // Sibling pass. A page that found nothing of its own may still link a page
  // that did resolve to a reward container — Blood, Blue and Eclipse Moon all
  // link Moons of Peril, which already resolved to the Lunar Chest. Their
  // shared category is the dungeon they stand in, not the activity, so neither
  // the category nor the reward-link scan reaches them.
  const rewardSourceByTitle = new Map<string, string>()
  for (const boss of bosses) {
    if (boss.classification === 'reward-page') rewardSourceByTitle.set(boss.title, boss.lootSourceId)
  }

  let adopted = 0
  for (const boss of bosses) {
    if (boss.classification !== 'no-loot-data') continue
    const links = allLinks.get(boss.title)
    if (links === undefined) continue

    let target: string | undefined
    for (const link of links) {
      const sourceId = rewardSourceByTitle.get(link)
      if (sourceId === undefined) continue
      // The link must be reciprocal. A one-way mention is not membership:
      // Tarn mentions Barrows without belonging to it.
      if (allLinks.get(link)?.has(boss.title) !== true) continue
      // And the linked page must be the activity itself, not a sibling boss.
      // Xamphur and Vasa Nistirio cross-reference each other as Kourend
      // characters without sharing a loot source.
      if (!(await isActivityCached(link))) continue
      target = sourceId
      break
    }
    if (target === undefined) continue

    const previous = sources.get(boss.lootSourceId)
    if (previous !== undefined) {
      previous.bosses = previous.bosses.filter((slug) => slug !== boss.slug)
      if (previous.bosses.length === 0) sources.delete(boss.lootSourceId)
    }
    boss.classification = 'reward-page'
    boss.lootSourceId = target
    sources.get(target)?.bosses.push(boss.slug)
    adopted += 1
    log(`  ${boss.title} adopts the loot source of a page it links: ${target}`)
  }
  if (adopted > 0) log(`  ${adopted} pages re-homed by link\n`)

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
