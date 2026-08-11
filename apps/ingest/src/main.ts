import { writeFile } from 'node:fs/promises'
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

async function triage(): Promise<void> {
  const manifest = await readManifest()
  const available = new Set(await listSnapshots('dropsline'))
  const results: TriageResult[] = []

  for (const entry of manifest.entries) {
    if (!available.has(entry.slug)) {
      log(`  !! no snapshot on disk for ${entry.title}; skipping`)
      continue
    }
    const snapshot = await readSnapshot('dropsline', entry.slug)
    const response = BucketResponseSchema.parse(snapshot.body)
    results.push(
      classify({
        title: entry.title,
        slug: entry.slug,
        rawRows: response.bucket ?? [],
        bucketError: response.error ?? null,
      })
    )
  }

  results.sort((a, b) => a.tier.localeCompare(b.tier) || a.title.localeCompare(b.title))

  const counts = new Map<Tier, number>(TIERS.map((tier) => [tier, 0]))
  for (const result of results) counts.set(result.tier, (counts.get(result.tier) ?? 0) + 1)

  const path = join(REPO_ROOT, 'docs', 'TRIAGE.md')
  await writeFile(path, renderTriageMarkdown(manifest, results, counts), 'utf8')

  log(`\nTier distribution across ${results.length} pages\n`)
  for (const tier of TIERS) {
    const count = counts.get(tier) ?? 0
    const share = results.length === 0 ? 0 : (count / results.length) * 100
    log(
      `  ${tier}  ${String(count).padStart(3)}  ${share.toFixed(1).padStart(5)}%  ${TIER_LABELS[tier]}`
    )
  }
  log(`\ndocs/TRIAGE.md written.`)
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
    case 'triage':
      await triage()
      return
    default:
      log('Usage: ingest <verify-schema | fetch --all | fetch --page <Title> | triage> [--delay ms]')
      process.exitCode = 1
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`)
  process.exitCode = 1
})
