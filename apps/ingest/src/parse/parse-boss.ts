import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { checkWeightsSum } from '../validate/weights-sum.js'
import { checkNotOnWatchlist, type Watchlist } from '../validate/watchlist.js'
import { checkItemsKnown } from '../validate/items-known.js'
import { checkEvMatches, type EvMatchesResult } from '../validate/ev-matches.js'
import { checkRefsResolve } from '../validate/refs-resolve.js'
import { checkRatesValid } from '../validate/rates-valid.js'
import { checkQtySane } from '../validate/qty-sane.js'
import type { ItemAllowlist } from '../items/allowlist.js'
import type { ItemIndex } from '../items/index.js'
import type { GePrices } from '../prices/ge-prices.js'
import { gePriceLookup } from '../prices/ge-prices.js'
import { REPO_ROOT, readSnapshot, slugify } from '../snapshots/store.js'
import { BossSchema, resolveSimContext, type Table } from '@osrs-loot-simulator/loot-model'
import { extractDropLines } from './wikitext-drops.js'
import { buildTableGroups, groupByHeading } from './build-tables.js'
import { extractRdtAccessLines } from './rdt-access.js'
import { assembleBoss } from './assemble-boss.js'
import { collectItemInputs } from './collect-items.js'
import { applyOverride, loadOverride, overrideSummary } from './overrides.js'

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
  status: 'verified' | 'needs_review' | 'manual_override' | 'parse_failed'
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
  // Loaded before anything else: an override carrying its own `tables` can
  // rescue a source the parser cannot reach at all, so the three
  // `parse_failed` exits below have to consult it rather than return first.
  const override = await loadOverride(options.slug)
  const overrideCarriesTables = override?.tables !== undefined

  const wikitextSlug = slugify(options.title)
  let wikitext: string
  try {
    const snapshot = await readSnapshot('wikitext', wikitextSlug)
    const parsed = snapshot.body as { parse?: { wikitext?: string } }
    wikitext = parsed.parse?.wikitext ?? ''
  } catch {
    if (!overrideCarriesTables) {
      return {
        slug: options.slug,
        title: options.title,
        status: 'parse_failed',
        reasons: [`no wikitext snapshot for '${options.title}' (slug '${wikitextSlug}')`],
      }
    }
    wikitext = ''
  }

  const lines = extractDropLines(wikitext)
  const rdtAccess = extractRdtAccessLines(wikitext)
  if (
    !overrideCarriesTables &&
    lines.length === 0 &&
    rdtAccess.lines.length === 0 &&
    rdtAccess.unresolved.length === 0
  ) {
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

  if (result.boss === null && !overrideCarriesTables) {
    return {
      slug: options.slug,
      title: options.title,
      status: 'parse_failed',
      reasons: [...result.errors, ...result.warnings, ...result.ambiguousGroups],
    }
  }

  // Everything downstream validates the MERGED document, not the generated
  // one — an override that introduces a broken table must fail the same
  // checks a bad parse would, never be rubber-stamped for being hand-written.
  const merged =
    override === null
      ? result.boss!
      : BossSchema.parse(applyOverride(result.boss, override, options.parserVersion))

  const itemInputs = collectItemInputs(merged.tables)

  const weightsSum = checkWeightsSum(merged.tables)
  const itemsKnown = checkItemsKnown(itemInputs, options.itemIndex, options.allowlist)
  const notOnWatchlist = checkNotOnWatchlist(options.watchlist, options.slug)
  const refsResolve = checkRefsResolve(merged, options.sharedTables)
  const ratesValid = checkRatesValid(merged)
  const qtySane = checkQtySane(merged)

  // ev_matches: real GE prices, joined by itemId, gemw-untradeable items
  // priced at 0 automatically (they carry no GE listing at all). Confirmed
  // non-convergent for Brutus (313.70 vs 597.57, 47.5% off) — see
  // docs/DECISIONS.md. It stays advisory: computed and reported whenever a
  // rendered-page snapshot is available, but never required for `verified`.
  const renderedHtml = await readRenderedHtml(options.title)
  const ctx = resolveSimContext(merged, {})
  const evMatches: EvMatchesResult = checkEvMatches(
    merged,
    ctx,
    gePriceLookup(options.gePrices),
    renderedHtml
  )

  const checks = [
    { check: 'weights_sum' as const, ok: weightsSum.ok, detail: weightsSum.detail },
    { check: 'refs_resolve' as const, ok: refsResolve.ok, detail: refsResolve.detail },
    { check: 'rates_valid' as const, ok: ratesValid.ok, detail: ratesValid.detail },
    // qty_sane used to be a hardcoded `true`, correctly, before Extension A
    // (docs/mechanics-model-proposal.md) added QtySpec's `formula` variant
    // and Table/TableRefNode's qtyMultiplier — the same shape of runtime-only
    // gap rates_valid already handles for formula rates. See
    // apps/ingest/src/validate/qty-sane.ts and its trip-wire test.
    { check: 'qty_sane' as const, ok: qtySane.ok, detail: qtySane.detail },
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
    qtySane.ok &&
    // An override supplying its own tables replaces exactly the structure the
    // parser was unsure about, so its ambiguous-group guesses no longer
    // describe the document being validated.
    (overrideCarriesTables || result.ambiguousGroups.length === 0)

  // PROJECT_PLAN.md 16's Phase 5 done-when is "every boss verified or
  // manual_override" — so a hand-authored document that passes every
  // deterministic check is `manual_override`, a terminal success state, not
  // `verified`. Keeping them distinct is the point: `verified` means the
  // pipeline derived this from the wiki unaided, and that claim would be
  // false here. A failing override still lands in `needs_review`.
  const status = !deterministicOk
    ? ('needs_review' as const)
    : override !== null
      ? ('manual_override' as const)
      : ('verified' as const)

  const reasons: string[] = overrideCarriesTables
    ? []
    : [...result.warnings, ...result.ambiguousGroups]
  if (override !== null) reasons.push(overrideSummary(override, result.boss !== null))
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
  if (!qtySane.ok) reasons.push(`qty_sane: ${qtySane.detail}`)
  reasons.push(`ev_matches (advisory, not part of the verified gate): ${evMatches.detail}`)

  const boss = {
    ...merged,
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
