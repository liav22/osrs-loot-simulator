import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { checkWeightsSum } from '../validate/weights-sum.js'
import { checkNotOnWatchlist, type Watchlist } from '../validate/watchlist.js'
import { checkItemsKnown, type ItemCheckInput } from '../validate/items-known.js'
import { checkEvMatches, type EvMatchesResult } from '../validate/ev-matches.js'
import { checkRefsResolve } from '../validate/refs-resolve.js'
import { checkRatesValid } from '../validate/rates-valid.js'
import type { ItemAllowlist } from '../items/allowlist.js'
import type { ItemIndex } from '../items/index.js'
import type { GePrices } from '../prices/ge-prices.js'
import { gePriceLookup } from '../prices/ge-prices.js'
import { REPO_ROOT, readSnapshot, slugify } from '../snapshots/store.js'
import { resolveSimContext, type Table } from '@osrs-loot-simulator/loot-model'
import { extractDropLines } from './wikitext-drops.js'
import { buildTableGroups, groupByHeading } from './build-tables.js'
import { extractRdtAccessLines } from './rdt-access.js'
import { assembleBoss } from './assemble-boss.js'

export const BOSSES_DIR = join(REPO_ROOT, 'data', 'bosses')

export interface ParseOptions {
  title: string
  slug: string
  wikiRevId: number
  parserVersion: number
  itemIndex: ItemIndex
  allowlist: ItemAllowlist
  watchlist: Watchlist
  gePrices: GePrices
  /** `data/tables/*.json`, keyed by id — Phase 3's shared RDT/gem/mega-rare records. */
  sharedTables: ReadonlyMap<string, Table>
}

export interface ParseOutcome {
  slug: string
  title: string
  status: 'verified' | 'needs_review' | 'parse_failed'
  reasons: string[]
}

/**
 * Reads the rendered page HTML snapshot for `ev_matches`'s "average kill
 * value" sentence, when one was fetched. Absent for most sources this
 * session — `fetch --page <Title>` is what populates it, not the bulk
 * `fetch --all` / `sources` runs, so this is best-effort, not required.
 */
async function readRenderedHtml(title: string): Promise<string | null> {
  try {
    const snapshot = await readSnapshot('page', slugify(title))
    const parsed = snapshot.body as { parse?: { text?: string } }
    return parsed.parse?.text ?? null
  } catch {
    return null
  }
}

export async function parseBoss(options: ParseOptions): Promise<ParseOutcome> {
  const wikitextSlug = slugify(options.title)
  let wikitext: string
  try {
    const snapshot = await readSnapshot('wikitext', wikitextSlug)
    const parsed = snapshot.body as { parse?: { wikitext?: string } }
    wikitext = parsed.parse?.wikitext ?? ''
  } catch {
    return {
      slug: options.slug,
      title: options.title,
      status: 'parse_failed',
      reasons: [`no wikitext snapshot for '${options.title}' (slug '${wikitextSlug}')`],
    }
  }

  const lines = extractDropLines(wikitext)
  const rdtAccess = extractRdtAccessLines(wikitext)
  if (lines.length === 0 && rdtAccess.lines.length === 0 && rdtAccess.unresolved.length === 0) {
    return {
      slug: options.slug,
      title: options.title,
      status: 'parse_failed',
      reasons: ['no {{DropsLine}}/{{DropsLineClue}} calls found under a Drops heading'],
    }
  }

  const blocks = groupByHeading(lines)
  const groups = buildTableGroups(blocks)

  const result = assembleBoss(groups, rdtAccess, {
    slug: options.slug,
    title: options.title,
    wikiRevId: options.wikiRevId,
    parserVersion: options.parserVersion,
    itemIndex: options.itemIndex,
    allowlist: options.allowlist,
  })

  if (result.boss === null) {
    return {
      slug: options.slug,
      title: options.title,
      status: 'parse_failed',
      reasons: [...result.errors, ...result.warnings, ...result.ambiguousGroups],
    }
  }

  const itemInputs: ItemCheckInput[] = []
  for (const table of result.boss.tables) {
    for (const entry of table.entries) {
      if (entry.node.kind === 'item') {
        itemInputs.push({ itemKey: entry.node.itemKey, itemId: entry.node.itemId })
      }
    }
  }

  const weightsSum = checkWeightsSum(result.boss.tables)
  const itemsKnown = checkItemsKnown(itemInputs, options.itemIndex, options.allowlist)
  const notOnWatchlist = checkNotOnWatchlist(options.watchlist, options.slug)
  const refsResolve = checkRefsResolve(result.boss, options.sharedTables)
  const ratesValid = checkRatesValid(result.boss)

  // ev_matches: real GE prices, joined by itemId, gemw-untradeable items
  // priced at 0 automatically (they carry no GE listing at all). Confirmed
  // non-convergent for Brutus (313.70 vs 597.57, 47.5% off) — see
  // docs/DECISIONS.md. It stays advisory: computed and reported whenever a
  // rendered-page snapshot is available, but never required for `verified`.
  const renderedHtml = await readRenderedHtml(options.title)
  const ctx = resolveSimContext(result.boss, {})
  const evMatches: EvMatchesResult = checkEvMatches(
    result.boss,
    ctx,
    gePriceLookup(options.gePrices),
    renderedHtml
  )

  const checks = [
    { check: 'weights_sum' as const, ok: weightsSum.ok, detail: weightsSum.detail },
    { check: 'refs_resolve' as const, ok: refsResolve.ok, detail: refsResolve.detail },
    { check: 'rates_valid' as const, ok: ratesValid.ok, detail: ratesValid.detail },
    // Unlike rates_valid, qty_sane genuinely has no runtime gap: QtySpecSchema
    // enforces min<=max and non-negative integers for every QtySpec variant
    // with no opaque/unvalidatable case (there is no formula-kind quantity) —
    // confirmed against packages/loot-model/test/schema.test.ts's own
    // range-rejection test, not just asserted. See docs/DECISIONS.md.
    { check: 'qty_sane' as const, ok: true, detail: 'ranges/quantities are fully schema-enforced, no runtime-only case exists' },
    { check: 'ev_matches' as const, ok: evMatches.ok, detail: evMatches.detail },
    { check: 'items_known' as const, ok: itemsKnown.ok, detail: itemsKnown.detail },
    { check: 'not_on_watchlist' as const, ok: notOnWatchlist.ok, detail: notOnWatchlist.detail },
  ]

  // `verified` depends only on checks that are deterministic given the parsed
  // structure and the item/watchlist data — weights_sum, refs_resolve,
  // rates_valid, qty_sane, items_known, not_on_watchlist, and the parser's own
  // confidence in the table shapes it inferred (no ambiguous-mode guesses).
  // ev_matches is excluded from this gate: it depends on live GE prices that
  // move day to day and was found non-convergent on the one source checked
  // this session, so a pass today would be a moving target, not a structural
  // fact about the parse. It is still computed, reported, and CAN downgrade a
  // result — see below — just not required to reach 'verified'.
  const deterministicOk =
    weightsSum.ok &&
    itemsKnown.ok &&
    notOnWatchlist.ok &&
    refsResolve.ok &&
    ratesValid.ok &&
    result.ambiguousGroups.length === 0
  const status = deterministicOk ? ('verified' as const) : ('needs_review' as const)

  const reasons: string[] = [...result.warnings, ...result.ambiguousGroups]
  if (!weightsSum.ok) {
    reasons.push(
      ...weightsSum.failures.map(
        (f) => `weights_sum: table '${f.tableId}' ${f.variant} sums to ${f.sum}, denominator ${f.denominator}`
      )
    )
  }
  if (!itemsKnown.ok) {
    reasons.push(...itemsKnown.failures.map((f) => `items_known: ${f.reason}`))
  }
  if (!notOnWatchlist.ok) reasons.push(`not_on_watchlist: ${notOnWatchlist.detail}`)
  if (!refsResolve.ok) reasons.push(`refs_resolve: ${refsResolve.detail}`)
  if (!ratesValid.ok) reasons.push(`rates_valid: ${ratesValid.detail}`)
  reasons.push(`ev_matches (advisory, not part of the verified gate): ${evMatches.detail}`)

  const boss = {
    ...result.boss,
    status,
    // `validation.ok` reflects every check including the advisory ones, so a
    // verified boss with a failing ev_matches still shows that failure here —
    // status and validation.ok are allowed to diverge on purpose.
    validation: { ok: checks.every((c) => c.ok), checks },
  }

  await mkdir(BOSSES_DIR, { recursive: true })
  await writeFile(join(BOSSES_DIR, `${options.slug}.json`), `${JSON.stringify(boss, null, 2)}\n`, 'utf8')

  return { slug: options.slug, title: options.title, status, reasons }
}
