import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { BOSS_CATEGORY, DROPS_BUCKET, SCHEMA_PAGES } from './wiki/fields.js'
import { USER_AGENT, WikiClient } from './wiki/client.js'
import { BucketResponseSchema } from './wiki/schemas.js'
import {
  REPO_ROOT,
  listSnapshots,
  readManifest,
  readSnapshot,
  slugify,
  writeManifest,
  writeSnapshot,
  type FetchManifest,
  type InventoryEntry,
} from './snapshots/store.js'
import { TIERS, TIER_LABELS, classify, type Tier, type TriageResult } from './triage/classify.js'
import { renderTriageMarkdown } from './triage/report.js'
import { INVENTORY_PATH, buildInventory } from './inventory/build.js'
import { auditExclusions } from './inventory/audit.js'
import {
  CLASSIFICATIONS,
  INCLUDED_CLASSIFICATIONS,
  InventorySchema,
  type Classification,
  type Inventory,
} from './inventory/schema.js'
import { buildItemIndex, readItemIndex } from './items/index.js'
import { loadItemAllowlist } from './items/allowlist.js'
import { loadItemFlags } from './items/item-flags.js'
import { loadWatchlist, checkWatchlistConsistency } from './validate/watchlist.js'
import {
  loadRepeatableOverrides,
  checkRepeatableOverridesConsistency,
} from './inventory/repeatable.js'
import { fetchGePrices } from './prices/ge-prices.js'
import { loadSharedTables } from './tables/shared-tables.js'
import { parseBoss } from './parse/parse-boss.js'
import { loadTemplateDefinitions } from './parse/expand-transclusions.js'
import { buildSiteIndex, writeSiteIndex } from './site-index.js'
import { collectCorpusItemNames, resolveItemIcons, writeItemIcons } from './items/icons.js'
import { listOverrideSlugs } from './parse/overrides.js'

/**
 * Phase 2 scope: snapshots and triage. There is deliberately no `parse`
 * command — nothing here produces a canonical boss document.
 */

function log(message: string): void {
  process.stdout.write(`${message}\n`)
}

function hasFlag(argv: readonly string[], flag: string): boolean {
  return argv.includes(flag)
}

function flagValue(argv: readonly string[], flag: string): string | undefined {
  const index = argv.indexOf(flag)
  return index === -1 ? undefined : argv[index + 1]
}

/** Re-fetch the bucket schema pages and diff them against `fields.ts`. */
async function verifySchema(client: WikiClient): Promise<void> {
  const { names, record } = await client.listBuckets()
  await writeSnapshot('schema', 'bucket-namespace', record)
  log(`Buckets defined on the wiki: ${names.length}`)

  const wanted = names.find((name) => name.toLowerCase() === `bucket:${DROPS_BUCKET}`)
  if (wanted === undefined) {
    log(`  !! DRIFT: no bucket named '${DROPS_BUCKET}' — fields.ts is stale`)
  } else {
    log(`  ok: '${DROPS_BUCKET}' exists as ${wanted}`)
  }
  if (names.some((name) => name.toLowerCase() === 'bucket:drops')) {
    log("  note: a bucket literally named 'drops' now exists (it did not at verification time)")
  }

  for (const page of SCHEMA_PAGES) {
    const { wikitext, record: schemaRecord } = await client.wikitext(page)
    await writeSnapshot('schema', slugify(page), schemaRecord)
    const fields = Object.keys(JSON.parse(wikitext) as Record<string, unknown>)
    log(`  ${page}: ${fields.join(', ')}`)
  }
}

async function fetchAll(client: WikiClient, delayMs: number): Promise<void> {
  log(`User-Agent: ${USER_AGENT}`)
  log(`Serial requests, ${delayMs}ms apart, maxlag=5.\n`)

  await verifySchema(client)

  log(`\nInventory from ${BOSS_CATEGORY} (the wiki is the only source for this list)`)
  const { titles, records } = await client.categoryMembers(BOSS_CATEGORY)
  for (const [index, record] of records.entries()) {
    await writeSnapshot('inventory', `category-bosses-${index}`, record)
  }
  log(`  ${titles.length} pages\n`)

  log('Latest revision ids (batched 50 per request)')
  const { revisions, records: revRecords } = await client.revisions(titles.map((t) => t.title))
  for (const [index, record] of revRecords.entries()) {
    await writeSnapshot('revisions', `batch-${index}`, record)
  }
  log(`  ${revisions.size} pages\n`)

  log(`Drop rows from bucket('${DROPS_BUCKET}')`)
  const entries: InventoryEntry[] = []
  for (const [index, page] of titles.entries()) {
    const slug = slugify(page.title)
    const { response, record } = await client.dropsFor(page.title)
    await writeSnapshot('dropsline', slug, record)
    const rowCount = response.bucket?.length ?? 0
    entries.push({
      title: page.title,
      slug,
      pageid: page.pageid,
      revid: revisions.get(page.title)?.revid ?? null,
      dropRowCount: rowCount,
      bucketError: response.error ?? null,
    })
    const position = `${String(index + 1).padStart(3)}/${titles.length}`
    log(`  ${position} ${page.title} — ${rowCount} rows${response.error ? ` (${response.error})` : ''}`)
  }

  const manifest: FetchManifest = {
    fetchedAt: new Date().toISOString(),
    userAgent: USER_AGENT,
    category: BOSS_CATEGORY,
    requestCount: client.requests,
    entries,
  }
  await writeManifest(manifest)
  log(`\n${client.requests} requests total. Manifest written.`)
}

/** Fetch one extra page's drops without touching the inventory. */
async function fetchPage(client: WikiClient, title: string): Promise<void> {
  const slug = slugify(title)
  const { response, record } = await client.dropsFor(title)
  await writeSnapshot('dropsline', slug, record)
  log(`${title} -> ${response.bucket?.length ?? 0} rows (${response.error ?? 'ok'})`)

  const { record: htmlRecord } = await client.pageHtml(title)
  await writeSnapshot('page', slug, htmlRecord)
  log(`${title} page HTML snapshotted`)
}

/** Triage every distinct loot source, not every boss page. */
async function triage(): Promise<void> {
  const manifest = await readManifest()
  const inventory = InventorySchema.parse(JSON.parse(await readFile(INVENTORY_PATH, 'utf8')))
  const available = new Set(await listSnapshots('dropsline'))
  const results: TriageResult[] = []

  for (const source of inventory.lootSources) {
    const slug = slugify(source.dropsPage)
    if (!available.has(slug)) {
      log(`  !! no snapshot on disk for ${source.dropsPage}; skipping`)
      continue
    }
    const snapshot = await readSnapshot('dropsline', slug)
    const response = BucketResponseSchema.parse(snapshot.body)
    results.push(
      classify({
        title: source.title,
        slug: source.id,
        rawRows: response.bucket ?? [],
        bucketError: response.error ?? null,
      })
    )
  }

  results.sort((a, b) => a.tier.localeCompare(b.tier) || a.title.localeCompare(b.title))

  const counts = new Map<Tier, number>(TIERS.map((tier) => [tier, 0]))
  for (const result of results) counts.set(result.tier, (counts.get(result.tier) ?? 0) + 1)

  const path = join(REPO_ROOT, 'docs', 'TRIAGE.md')
  await writeFile(path, renderTriageMarkdown(manifest, inventory, results, counts), 'utf8')

  reportDistribution(inventory, results, counts)
  log(`\ndocs/TRIAGE.md written.`)
}

function reportDistribution(
  inventory: Inventory,
  results: readonly TriageResult[],
  counts: ReadonlyMap<Tier, number>
): void {
  const byClassification = new Map<Classification, number>()
  for (const boss of inventory.bosses) {
    byClassification.set(
      boss.classification,
      (byClassification.get(boss.classification) ?? 0) + 1
    )
  }

  log(`\nBoss pages: ${inventory.bosses.length}  ->  loot sources: ${inventory.lootSources.length}\n`)
  log('Page classification')
  for (const classification of CLASSIFICATIONS) {
    const count = byClassification.get(classification) ?? 0
    const kept = INCLUDED_CLASSIFICATIONS.includes(classification) ? 'keep   ' : 'exclude'
    log(`  ${kept}  ${String(count).padStart(3)}  ${classification}`)
  }

  const included = inventory.lootSources.filter((source) => source.include)
  const tierOf = new Map(results.map((result) => [result.title, result.tier]))
  const gateEligible = included.filter((source) => {
    const tier = tierOf.get(source.title)
    return tier === 'A' || tier === 'B' || tier === 'C' || tier === 'E'
  })

  log(`\nTier distribution across ${results.length} loot sources\n`)
  for (const tier of TIERS) {
    const count = counts.get(tier) ?? 0
    const share = results.length === 0 ? 0 : (count / results.length) * 100
    log(
      `  ${tier}  ${String(count).padStart(3)}  ${share.toFixed(1).padStart(5)}%  ${TIER_LABELS[tier]}`
    )
  }

  log(`\nGate, measured against loot sources rather than pages:`)
  log(`  in scope                    ${included.length}`)
  log(`  expected to parse cleanly   ${gateEligible.length}`)
  log(`  excluded                    ${inventory.lootSources.length - included.length}`)
}

/**
 * Parses every included loot source at the requested tier(s) whose wikitext
 * is already on disk. `--source <id>` narrows to one. Nothing produced here
 * `verified` requires every deterministic check (weights_sum, refs_resolve,
 * rates_valid, qty_sane, items_known, not_on_watchlist, and a confident —
 * non-guessed — table shape). `ev_matches` is computed and reported but is
 * advisory: it depends on live GE prices that move day to day and was found
 * non-convergent on Brutus this session (313.70 vs 597.57, 47.5% off), so it
 * cannot gate `verified` — see docs/DECISIONS.md.
 *
 * Default is every tier: `include: true` is the only real gate on what gets
 * attempted (same principle landmine #12 already established for overrides —
 * a tier is how much machinery a page LOOKS like it needs, not a decision
 * that it's not worth building). `--tier` narrows to specific tier(s) for a
 * targeted or iterative run; it is a filter, not a default exclusion. See
 * docs/DECISIONS.md, "Should tier gate parsing at all?".
 */
async function parseCommand(argv: readonly string[]): Promise<void> {
  const tierFilter = new Set((flagValue(argv, '--tier') ?? TIERS.join(',')).split(','))
  const sourceFilter = flagValue(argv, '--source')

  const inventory = InventorySchema.parse(JSON.parse(await readFile(INVENTORY_PATH, 'utf8')))
  const itemIndex = await readItemIndex()
  const allowlist = await loadItemAllowlist()
  const itemFlags = await loadItemFlags()
  const watchlist = await loadWatchlist()
  const gePrices = await fetchGePrices(USER_AGENT)
  log(`Loaded ${gePrices.size} live GE prices.\n`)
  const sharedTables = await loadSharedTables()
  const templates = await loadTemplateDefinitions()
  log(`Loaded ${templates.size} template definition(s) for transclusion expansion.\n`)

  // Read once, up front: rule 6 of checkWatchlistConsistency needs to know
  // which sources have a shipped override to catch a `detail` that never
  // mentions its own — the same "read once" reasoning as `overrideOrphans`
  // below, just needed earlier now.
  const overrideSlugs = new Set(await listOverrideSlugs())

  const watchlistIssues = checkWatchlistConsistency(watchlist, inventory, overrideSlugs)
  if (watchlistIssues.length > 0) {
    log(`!! data/mechanics-watchlist.json disagrees with data/_inventory.json:`)
    for (const issue of watchlistIssues) log(`     [${issue.lootSourceId}] ${issue.message}`)
    log('')
  }

  // An authored override is a human saying "build this source", so it always
  // gets parsed regardless of tier. Without this, a source could have a
  // complete, correct, tested override sitting in `data/overrides/` and
  // silently never be built — which is exactly what happened to Reward pool:
  // it is tier D, every documented parse invocation is `--tier A,B,C`, and so
  // `data/bosses/reward-pool.json` never existed no matter what anyone
  // authored. The tier filter is a triage convenience for deciding what to
  // *attempt*; it was never meant to overrule an explicit human decision.
  //
  // `parseBoss` already handles the from-scratch case end to end
  // (`overrideCarriesTables` rescues all three of its `parse_failed` exits, and
  // `applyOverride` accepts a null generated document and emits
  // `source: 'override'`) — the capability existed, nothing ever reached it.
  const overrideOrphans = [...overrideSlugs].filter(
    (slug) => !inventory.lootSources.some((source) => source.id === slug)
  )
  if (overrideOrphans.length > 0) {
    // A typo'd filename is otherwise invisible: `loadOverride` looks the file
    // up BY slug, so an override named for a source that does not exist is
    // simply never opened by anything, forever.
    log(`!! data/overrides/ names ${overrideOrphans.length} slug(s) with no loot source:`)
    for (const slug of overrideOrphans) log(`     ${slug}.json`)
    log('')
  }

  const sources = inventory.lootSources.filter(
    (source) =>
      source.include &&
      (tierFilter.has(source.tier) || overrideSlugs.has(source.id)) &&
      (sourceFilter === undefined || source.id === sourceFilter)
  )

  const forcedByOverride = sources.filter(
    (source) => !tierFilter.has(source.tier) && overrideSlugs.has(source.id)
  )
  log(
    `Parsing ${sources.length} loot source(s) at tier ${[...tierFilter].join(',')}` +
      (forcedByOverride.length > 0
        ? ` (+${forcedByOverride.length} outside that tier, pulled in by an authored override: ` +
          `${forcedByOverride.map((s) => s.id).join(', ')})`
        : '') +
      '\n'
  )

  const outcomes: Awaited<ReturnType<typeof parseBoss>>[] = []
  for (const source of sources) {
    const revid =
      inventory.bosses.find((boss) => boss.lootSourceId === source.id)?.revid ?? 0
    const outcome = await parseBoss({
      title: source.dropsPage,
      slug: source.id,
      wikiRevId: revid ?? 0,
      parserVersion: 1,
      itemIndex,
      allowlist,
      itemFlags,
      watchlist,
      gePrices,
      sharedTables,
      templates,
      repeatable: source.repeatable,
      // A many-to-one source's common name (e.g. "Chambers of Xeric" for the
      // `Ancient chest` drops page) is not always a substring of the page
      // name `fuzzy.ts` already searches, so it would otherwise be
      // unfindable under the name players actually use.
      aliases: source.title !== source.dropsPage ? [source.title] : [],
    })
    outcomes.push(outcome)
    const mark = outcome.status === 'parse_failed' ? '  !! ' : '     '
    log(`${mark}${outcome.title.padEnd(32)} ${outcome.status}`)
    for (const reason of outcome.reasons) log(`        - ${reason}`)
  }

  const counts = { needs_review: 0, parse_failed: 0, verified: 0, manual_override: 0 }
  for (const outcome of outcomes) counts[outcome.status] += 1
  log(
    `\n${outcomes.length} parsed: ${counts.needs_review} needs_review, ` +
      `${counts.parse_failed} parse_failed, ${counts.verified} verified` +
      `${counts.manual_override > 0 ? `, ${counts.manual_override} manual_override` : ''}.`
  )
  log(`data/bosses/*.json written for everything that assembled.`)
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const command = argv[0]
  const delayMs = Number(flagValue(argv, '--delay') ?? process.env['INGEST_DELAY_MS'] ?? 1000)
  const client = new WikiClient({ delayMs })

  switch (command) {
    case 'verify-schema':
      await verifySchema(client)
      return
    case 'fetch': {
      const page = flagValue(argv, '--page')
      if (page !== undefined) {
        await fetchPage(client, page)
        return
      }
      if (!hasFlag(argv, '--all')) {
        log('Usage: ingest fetch --all | ingest fetch --page <Title>')
        process.exitCode = 1
        return
      }
      await fetchAll(client, delayMs)
      return
    }
    case 'sources': {
      const inventory = await buildInventory(client, { log })
      log(
        `data/_inventory.json written: ${inventory.bosses.length} pages -> ` +
          `${inventory.lootSources.length} loot sources.`
      )
      const repeatableOverrides = await loadRepeatableOverrides()
      const orphans = checkRepeatableOverridesConsistency(repeatableOverrides, inventory)
      if (orphans.length > 0) {
        log(`\n!! data/repeatable-overrides.json has ${orphans.length} orphaned entr(ies):`)
        for (const orphan of orphans) log(`     ${orphan.message}`)
      }
      return
    }
    case 'audit-exclusions': {
      const rows = await auditExclusions(client, log)
      for (const row of rows) {
        log(
          `${row.suspicious ? '  !! ' : '     '}${row.title.padEnd(32)} ` +
            `monster=${row.isMonster ? 'yes' : 'no '} ` +
            `combat=${String(row.combatLevel ?? '—').padStart(4)} ` +
            `hp=${String(row.hitpoints ?? '—').padStart(5)}`
        )
      }
      const suspicious = rows.filter((row) => row.suspicious)
      log(`\n${suspicious.length} of ${rows.length} exclusions carry a real combat level.`)
      return
    }
    case 'item-index': {
      const index = await buildItemIndex(client, log)
      const unresolved = index.entries.filter((entry) => entry.itemId === null).length
      log(
        `\ndata/_item-index.json written: ${index.entries.length} pages, ` +
          `${unresolved} unresolved (multi-id or unparseable).`
      )
      return
    }
    case 'item-icons': {
      const names = await collectCorpusItemNames()
      log(`Resolving icons for ${names.length} distinct corpus items…`)
      const resolved = await resolveItemIcons(client, names)
      await writeItemIcons(resolved)
      const { total, viaImageInfo, viaSearch, unresolved } = resolved.stats
      log(
        `data/item-icons.json written: ${viaImageInfo + viaSearch}/${total} resolved ` +
          `(${viaImageInfo} via imageinfo, ${viaSearch} via case-insensitive search), ` +
          `${unresolved} unresolved.`
      )
      if (unresolved > 0) {
        // Named, not just counted: an unresolved item renders a placeholder in
        // the grid, and the only way to know whether that is correct is to
        // look at the item.
        log(`  unresolved: ${resolved.unresolved.join(', ')}`)
      }
      log(`  ${client.requests} wiki request(s) made; the rest came from data/snapshots/item-icon/.`)
      return
    }
    case 'triage':
      await triage()
      return
    case 'parse': {
      await parseCommand(argv)
      return
    }
    case 'site-index': {
      const index = await buildSiteIndex()
      await writeSiteIndex(index)
      const byStatus = { verified: 0, needs_review: 0, manual_override: 0 }
      for (const entry of index.entries) byStatus[entry.status] += 1
      log(
        `data/index.json written: ${index.entries.length} sources ` +
          `(${byStatus.verified} verified, ${byStatus.needs_review} needs_review, ${byStatus.manual_override} manual_override)`
      )
      return
    }
    default:
      log(
        'Usage: ingest <verify-schema | fetch --all | fetch --page <Title> | sources | ' +
          'audit-exclusions | item-index | item-icons | triage | parse [--tier A[,B,C]] [--source <id>] ' +
          '(default: every tier) | ' +
          'site-index> [--delay ms]'
      )
      process.exitCode = 1
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
  process.exitCode = 1
})
