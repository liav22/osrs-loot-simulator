import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { checkWeightsSum } from '../validate/weights-sum.js'
import { checkNotOnWatchlist, type Watchlist } from '../validate/watchlist.js'
import { checkItemsKnown } from '../validate/items-known.js'
import { checkEvMatches, type EvMatchesResult } from '../validate/ev-matches.js'
import { checkRefsResolve } from '../validate/refs-resolve.js'
import { checkRatesValid } from '../validate/rates-valid.js'
import { checkQtySane } from '../validate/qty-sane.js'
import { checkDropsCovered } from '../validate/drops-covered.js'
import type { ItemAllowlist } from '../items/allowlist.js'
import type { ItemIndex } from '../items/index.js'
import type { GePrices } from '../prices/ge-prices.js'
import { gePriceLookup } from '../prices/ge-prices.js'
import { REPO_ROOT, readSnapshot, slugify } from '../snapshots/store.js'
import { BossSchema, resolveSimContext, type Table } from '@osrs-loot-simulator/loot-model'
import { extractDropLines, findRowlessTemplateBlocks } from './wikitext-drops.js'
import { expandTransclusions, type TemplateDefinitions } from './expand-transclusions.js'
import {
  buildTableGroups,
  checkBundleSignals,
  checkTransclusionPartitions,
  describePartition,
  groupByHeading,
} from './build-tables.js'
import { extractRdtAccessLines } from './rdt-access.js'
import { assembleBoss } from './assemble-boss.js'
import { collectItemInputs } from './collect-items.js'
import { applyOverride, loadOverride, overrideSummary } from './overrides.js'
import { TABLES_DIR } from '../tables/shared-tables.js'
import { deriveStatusTier } from '../tier.js'

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
  /** From `data/_inventory.json`'s `LootSource.repeatable` — see `inventory/repeatable.ts`. */
  repeatable: boolean
  /** See `AssembleOptions.aliases` — usually `[]`; `main.ts` populates it from `LootSource.title`. */
  aliases: string[]
  /** `data/tables/*.json`, keyed by id — Phase 3's shared RDT/gem/mega-rare records. */
  sharedTables: ReadonlyMap<string, Table>
  /**
   * `Template:` wikitext snapshots, keyed by normalised name — what lets a
   * drop sub-table written as a transclusion be read at all. See
   * `expand-transclusions.ts`.
   */
  templates: TemplateDefinitions
  /**
   * Where the document is written. Defaults to the real `data/bosses/` —
   * overridable so a test can run the real pipeline against a scratch
   * directory and diff the result against the committed file without
   * mutating it. See `test/corpus-reproducibility.test.ts`.
   */
  outputDir?: string
  /**
   * Where a confirmed co-drop bundle's `data/tables/<id>.json` is written.
   * Defaults to the real `data/tables/` — overridable for the same reason
   * `outputDir` is: a test running the real pipeline must never write into
   * committed data. See `test/corpus-reproducibility.test.ts`.
   */
  tablesDir?: string
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

  // Transclusions are expanded BEFORE anything reads the page, so a drop
  // sub-table written as `{{TalismanDropLines|1/128}}` becomes the
  // `{{DropsLine}}` rows the extractor understands instead of vanishing. The
  // shared-table access calls (`{{RareDropTable|...}}`) deliberately survive
  // expansion untouched — `rdt-access.ts` models those as a `tableRef` and
  // reads them off this same text.
  const expansion = expandTransclusions(wikitext, options.templates)
  const lines = extractDropLines(expansion.wikitext)
  const rdtAccess = extractRdtAccessLines(expansion.wikitext)
  // What expansion could NOT reach: a sub-section that still has a template
  // for a body and no rows to show for it. Reported, never swallowed.
  const rowlessBlocks = findRowlessTemplateBlocks(expansion.wikitext)
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
  // Standing, on every transcluded block — not just the ones whose mode it
  // decides. A sub-table whose rows do not sum to its own declared access rate
  // is telling you the page overrides them (Vorkath states EFFECTIVE seed
  // chances that fold in its main table's own seed slots), and that is worth
  // saying out loud rather than only when it happens to change a mode.
  const partitions = checkTransclusionPartitions(blocks)
  // Standing, on every block, for the same reason — a co-drop bundle
  // (docs/DECISIONS.md's "bundle shape, assessed" entry) is otherwise
  // invisible to weights_sum whenever the table has slack, which is exactly
  // how `the-leviathan`/`the-whisperer`/`vardorvis` shipped `verified` wrong.
  const bundleSignals = checkBundleSignals(blocks)
  // A signal that fired but couldn't be confirmed for automatic modelling
  // (Mad Angel's `oneOf`-and-bundle compound) is a correctness gap the
  // document does not disclose on its own — blocks `verified` below, the same
  // way an ambiguous mode guess does.
  const unconfirmedBundles = bundleSignals.filter((signal) => !signal.confirmed)

  const result = assembleBoss(groups, rdtAccess, {
    slug: options.slug,
    title: options.title,
    wikiRevId: options.wikiRevId,
    parserVersion: options.parserVersion,
    itemIndex: options.itemIndex,
    allowlist: options.allowlist,
    repeatable: options.repeatable,
    aliases: options.aliases,
  })

  if (result.boss === null && !overrideCarriesTables) {
    return {
      slug: options.slug,
      title: options.title,
      status: 'parse_failed',
      reasons: [...result.errors, ...result.warnings, ...result.ambiguousGroups],
    }
  }

  // Every confirmed bundle's shared table, written to disk and folded into a
  // LOCAL copy of the shared-tables map — this document's own `refs_resolve`/
  // `drops_covered` checks (below) need to see it, and `options.sharedTables`
  // was loaded once before this source's own bundles were known to exist.
  // Same mechanism `data/tables/`'s hand-authored records already use; these
  // are generated rather than authored, deterministically, from this same
  // parse, so re-running always reproduces the identical file.
  const tablesDir = options.tablesDir ?? TABLES_DIR
  if (result.bundleTables.length > 0) {
    await mkdir(tablesDir, { recursive: true })
    for (const table of result.bundleTables) {
      await writeFile(join(tablesDir, `${table.id}.json`), `${JSON.stringify(table, null, 2)}\n`, 'utf8')
    }
  }
  const sharedTables =
    result.bundleTables.length === 0
      ? options.sharedTables
      : new Map([...options.sharedTables, ...result.bundleTables.map((table) => [table.id, table] as const)])

  // Everything downstream validates the MERGED document, not the generated
  // one — an override that introduces a broken table must fail the same
  // checks a bad parse would, never be rubber-stamped for being hand-written.
  const merged =
    override === null
      ? result.boss!
      : BossSchema.parse(
          applyOverride(result.boss, override, options.parserVersion, options.repeatable)
        )

  const itemInputs = collectItemInputs(merged.tables)

  // Resolved against the boss's own `contextDefaults`, not the package
  // default: a formula-driven weight (ToA's raid-level-scaled unique pool)
  // reads `SimContext`, and a source that pins a default raid level means it.
  const weightsSum = checkWeightsSum(merged.tables, resolveSimContext(merged, {}))
  const itemsKnown = checkItemsKnown(itemInputs, options.itemIndex, options.allowlist)
  const notOnWatchlist = checkNotOnWatchlist(options.watchlist, options.slug)
  const refsResolve = checkRefsResolve(merged, sharedTables)
  const ratesValid = checkRatesValid(merged)
  const qtySane = checkQtySane(merged)
  // The one check that is NOT closed-world over the extracted document: it
  // compares the document against the wiki's own rendered drop rows, which is
  // what makes a silently-dropped transcluded sub-table visible. See
  // validate/drops-covered.ts.
  const dropsCovered = await checkDropsCovered(options.title, merged.tables, sharedTables)

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
    { check: 'drops_covered' as const, ok: dropsCovered.ok, detail: dropsCovered.detail },
    // Same exemption as the gate below: an override supplying its own
    // `tables` replaces the structure the parser was unsure about, so a
    // parser-side ambiguous-group guess or unconfirmed bundle signal no
    // longer describes the document being validated.
    {
      check: 'heading_unambiguous' as const,
      ok: overrideCarriesTables || (result.ambiguousGroups.length === 0 && unconfirmedBundles.length === 0),
      detail: overrideCarriesTables
        ? 'override supplies its own tables; parser-side heading guesses do not apply'
        : [
            ...result.ambiguousGroups,
            ...unconfirmedBundles.map(
              (signal) =>
                `bundle signal in "${signal.heading}" not confirmed for automatic modelling: ${signal.detail}`
            ),
          ].join('; ') || 'no ambiguous headings or unconfirmed bundle signals',
    },
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
    // Part of the gate, deliberately. `verified` has meant "the pipeline
    // derived this from the wiki unaided" all project, and a document missing
    // drops the wiki lists has not met that claim — whatever else it got
    // right. Turning this on moved 21 sources to `needs_review`; that is the
    // check working, not a regression.
    dropsCovered.ok &&
    // Part of the gate for a reason paid for once already. A transclusion that
    // fails to expand does not necessarily produce NO row — it can produce a
    // plausible wrong one, because the template's own `{{#switch:}}` falls
    // through to a literal default when the `{{#expr:}}` selecting between its
    // cases cannot be evaluated. That shipped `WildernessSlayerDropTable`'s
    // Larran's key at a flat 1/50 on five sources whose real, published rates
    // are 1/55 to 1/76, and `drops_covered` passed all five: coverage is by
    // item NAME, so a recovered row with a wrong rate looks exactly like a
    // correct one. A wrong number is worse than a missing row, so this blocks
    // — UNLESS an override supplies its own tables, in which case (same
    // reasoning as the ambiguous-group/unconfirmed-bundle exemption just
    // below) the unexpandable transclusion describes the GENERATED document's
    // own shortfall, not the one being validated. Confirmed on Black Knight
    // Titan/Obor: `{{GeneralSeedDropLines}}` is a pure `{{#invoke:}}` Lua call
    // no wikitext expansion could ever reach, hand-modelled instead (see
    // their own override `note`s) — without this exemption a correct,
    // wiki-verified override could never lift the source off `needs_review`.
    (overrideCarriesTables || expansion.unexpandable.length === 0) &&
    // An override supplying its own tables replaces exactly the structure the
    // parser was unsure about, so its ambiguous-group guesses (and an
    // unconfirmed bundle signal, which describes the GENERATED document, not
    // the override) no longer describe the document being validated.
    (overrideCarriesTables || (result.ambiguousGroups.length === 0 && unconfirmedBundles.length === 0))

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
    : [
        ...result.warnings,
        ...result.ambiguousGroups,
        ...unconfirmedBundles.map(
          (signal) =>
            `bundle signal in "${signal.heading}" not confirmed for automatic modelling: ${signal.detail}`
        ),
      ]
  // Advisory, not part of the gate: `drops_covered` decides completeness
  // against the wiki's own drop rows. These two say WHY a document is short,
  // which is what a vanished section could never say for itself — so they are
  // surfaced only when there is a shortfall to explain, and a named
  // sub-heading is what separates a real sub-table from the section preamble
  // where page furniture (drop logs, average-value boxes) legitimately lives.
  if (!dropsCovered.ok || expansion.unexpandable.length > 0) {
    for (const { template, reason } of expansion.unexpandable) {
      reasons.push(`transclusion not expanded: '${template}' — ${reason}`)
    }
      for (const check of partitions.filter((p) => p.verdict === 'not-a-partition')) {
      reasons.push(`transcluded sub-table {{${check.template}}}${describePartition(check)}`)
    }
    for (const block of rowlessBlocks.filter((b) => b.heading !== '')) {
      const where =
        block.section === '' ? `"${block.heading}"` : `"${block.section}" / "${block.heading}"`
      reasons.push(
        `sub-section ${where} has a template body but produced no drop rows: ${block.templates.join(', ')}`
      )
    }
  }
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
  if (!dropsCovered.ok) reasons.push(`drops_covered: ${dropsCovered.detail}`)
  reasons.push(`ev_matches (advisory, not part of the verified gate): ${evMatches.detail}`)

  const { tier: statusTier, reason: statusReason } = deriveStatusTier(
    status,
    checks,
    options.slug,
    options.watchlist
  )

  const boss = {
    ...merged,
    status,
    statusTier,
    statusReason,
    // `validation.ok` reflects every check including the advisory ones, so a
    // verified boss with a failing ev_matches still shows that failure here —
    // status and validation.ok are allowed to diverge on purpose.
    validation: { ok: checks.every((c) => c.ok), checks },
  }

  const outputDir = options.outputDir ?? BOSSES_DIR
  await mkdir(outputDir, { recursive: true })
  await writeFile(join(outputDir, `${options.slug}.json`), `${JSON.stringify(boss, null, 2)}\n`, 'utf8')

  return { slug: options.slug, title: options.title, status, reasons }
}
