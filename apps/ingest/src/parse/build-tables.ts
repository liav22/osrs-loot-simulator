import type { Condition } from '@osrs-loot-simulator/loot-model'
import { ALWAYS_RARITY, FRACTION_RARITY } from '../wiki/fields.js'
import type { WikitextDropLine } from './wikitext-drops.js'
import { evaluateRarityTemplate } from './rarity-templates.js'

/**
 * Turns extracted `{{DropsLine}}` calls into canonical tables, following
 * PROJECT_PLAN.md 6.4-6.5.
 *
 * The parser's real job is inferring structure the wiki writes for humans.
 * Two structural signals decide a heading-group's mode, checked in this
 * order — heading text is a hint, not the final word, because a heading like
 * "Unique" carries no mode-indicating keyword at all and must be inferred
 * from the shape of its own rarities:
 *
 *   1. Every rarity in the group is `Always` -> `always`.
 *   2. Heading text says `Tertiary` / `Secondary` -> `independent`.
 *   3. Heading text says `Pre-roll` -> `preroll`.
 *   4. Every entry shares one denominator -> `weighted` (heuristic 1: equal
 *      denominators mean one table). Adjacent weighted headings sharing a
 *      denominator merge into one table, exactly as Brutus' five headings
 *      collapse to one `/81` table.
 *   5. Entries have heterogeneous denominators, none of them `Always` -> a
 *      set of independent fixed-rate rolls. Whether that means `preroll`
 *      (mutually exclusive, short-circuits later tables — the wilderness
 *      bosses' "Unique" tables work this way) or `independent` (can stack)
 *      is NOT decidable from rarities alone; the caller marks it
 *      `needs_review` rather than guess, per heuristic 6.
 *
 * Nothing here parses prose. A boss whose real access mechanic is described
 * only in sentences — sequential roll-until-success chains, point scaling —
 * produces a table for whatever IS in `{{DropsLine}}` rows and nothing more;
 * catching that gap is what `docs/TRIAGE.md` review and the mechanics
 * watchlist are for, not this module.
 */

export interface ParsedRate {
  kind: 'always' | 'fixed'
  num: number
  den: number
}

export interface ParsedEntry {
  name: string
  quantity: string
  noted: boolean
  members: boolean
  freeToPlay: boolean
  rarity: ParsedRate
  /** Share of the group's denominator, when the group is `weighted`. */
  weight: number | null
  /** Conditions a rarity template's evaluation contributed (e.g. `onSlayerTask`). */
  extraConditions?: Condition[]
}

export type ParsedMode = 'always' | 'preroll' | 'weighted' | 'independent'

/**
 * The access-rate identity for a block that came entirely from ONE
 * transclusion: do its rows' rates sum to the access rate that transclusion
 * declared?
 *
 * This is the real test for "these rows are one roll that picks one item," and
 * it is an arithmetic identity rather than an appeal to where the numbers came
 * from. If the rows are mutually exclusive alternatives reached by a single
 * access roll, then by total probability their rates must sum to exactly the
 * access rate. Measured across the corpus it separates the two shapes cleanly:
 *
 *   - seed / herb / talisman sub-tables: ratio 1.0000 on every source
 *   - `WildernessSlayerDropTable`: declares no access rate at all (its two rows
 *     derive from different inputs — combat level and hitpoints — and really
 *     are independent rolls), so there is nothing to test and this abstains
 *   - Vorkath's seeds: 1.6665, correctly REFUSED — that page overrides two
 *     rarities with EFFECTIVE chances folding in the main table's own seed
 *     slots, so its rows are not a partition of the seed roll alone
 *
 * An earlier candidate — "every rate derives from one `{{#vardefine:}}` base" —
 * was rejected on evidence: `Uniques/Corporeal Beast` has no `#vardefine` at
 * all and is provably mutually exclusive, so provenance is not the mechanism.
 * See docs/DECISIONS.md.
 */
export interface PartitionCheck {
  template: string
  /** The declared access rate as the page wrote it, e.g. `5/139`. */
  accessRate: string
  /** Sum of the block's own rates, and that sum divided by the access rate. */
  sum: number
  ratio: number
  verdict: 'partition' | 'not-a-partition' | 'no-access-rate'
}

export interface ParsedTableGroup {
  mode: ParsedMode
  headings: string[]
  /**
   * The top-level Drops/Rewards section this group's rows came from (`''` for
   * the common single-section page — see `WikitextDropLine.section`).
   * `assembleBoss` reads it to fall back to a `members`/`freeToPlay` condition
   * for a source whose split is SECTION-level rather than per-row (Obor,
   * Bryophyta's `==Members' worlds drops==`/`==Free-to-play worlds drops==`)
   * — see `conditionsFor`'s comment for why a per-row marker still wins.
   */
  section: string
  denominator: number | null
  entries: ParsedEntry[]
  /** Set when the group's shape does not cleanly fit any mode. */
  ambiguous: string | null
  /** Set when a heterogeneous-denominator group's mode was confirmed by a structural or textual signal, not guessed. Human-readable, for `notes`. */
  confirmedBy?: string
  /** The access-rate identity, for any block that came entirely from one transclusion. */
  partition?: PartitionCheck
}

/** A resolved rarity, or the reason it could not be resolved. */
interface RarityResolution {
  rate: ParsedRate | null
  conditions?: Condition[]
  /** Set when the string names a `{{Template|...}}` not in the rarity-template registry. */
  unknownTemplate?: string
}

const TEMPLATE_CALL = /^\{\{.+\}\}$/s

/**
 * A `rarity=` value is usually a literal `Always` or `N/M` fraction, but can
 * also be a template call — `{{Brimstone rarity|784}}` — that the
 * rarity-template registry (`rarity-templates.ts`) resolves. An unrecognised
 * template name is reported via `unknownTemplate`, distinct from a plain
 * malformed literal, and must never be silently dropped or guessed at.
 */
function parseRarity(rarity: string): RarityResolution {
  const trimmed = rarity.trim()
  if (ALWAYS_RARITY.test(trimmed)) return { rate: { kind: 'always', num: 1, den: 1 } }

  const match = FRACTION_RARITY.exec(trimmed)
  if (match !== null) {
    const num = Number(match[1]?.replace(/,/g, ''))
    const den = Number(match[2]?.replace(/,/g, ''))
    if (Number.isFinite(num) && Number.isFinite(den) && den > 0) {
      return { rate: { kind: 'fixed', num, den } }
    }
  }

  if (TEMPLATE_CALL.test(trimmed)) {
    const { name, result } = evaluateRarityTemplate(trimmed)
    if (result === null) return { rate: null, unknownTemplate: name }
    return { rate: { kind: 'fixed', num: result.num, den: result.den }, conditions: result.conditions }
  }

  return { rate: null }
}

/**
 * `weight` is against `denominator`, NOT necessarily equal to `rate.num`:
 * when a group was homogenised onto a merged LCM denominator
 * (`tryHomogenizeDenominators`), an entry's own `rate.den` can be a clean
 * divisor of that merged value rather than equal to it (Kraken's Trident of
 * the seas is `1/512` while the table's merged denominator is `512` — equal
 * here, but Gemstone Crab's Uncut dragonstone is `1/500` against a merged
 * `4000`, so its weight is `8`, not `1`), so the weight is always rescaled
 * to the denominator actually being used, never assumed already-scaled.
 */
function toEntry(
  line: WikitextDropLine,
  rate: ParsedRate,
  denominator: number | null,
  conditions?: Condition[]
): ParsedEntry {
  return {
    name: line.name,
    quantity: line.quantity,
    noted: line.noted,
    members: line.members,
    freeToPlay: line.freeToPlay,
    rarity: rate,
    weight: denominator === null ? null : (rate.num * denominator) / rate.den,
    ...(conditions !== undefined ? { extraConditions: conditions } : {}),
  }
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b)
}

function lcm(a: number, b: number): number {
  return (a / gcd(a, b)) * b
}

/**
 * A merged denominator may be at most this many times the largest original
 * denominator. Every real same-table case found in the tier A/B/C corpus
 * (Kraken's Trident of the seas at 1/512 among five /128 entries; Gemstone
 * Crab's Uncut dragonstone at 1/500 among seven /32 entries; Araxxor's
 * Supplies section mixing 1/8 and 1/16) merges at 2x-8x. Genuinely unrelated
 * items whose denominators happen to be small coprime numbers (The
 * Nightmare's Uniques: 300/420/750/960) blow this up by two orders of
 * magnitude, which is the point of the cap — it rejects them rather than
 * force a merge the ratio itself argues against.
 */
const LCM_MERGE_RATIO_CAP = 10

/**
 * Rewrites a set of `fixed`-rate entries onto one common denominator via
 * their LCM, when every original denominator is an integer, the result is a
 * "clean" small multiple of the largest one (`LCM_MERGE_RATIO_CAP`), AND
 * the rescaled weights don't exceed that merged denominator. This is
 * `weighted`-shaped heuristic 1 (equal denominators mean one table)
 * generalised: the wiki sometimes prints one item's rarity against its own
 * un-reduced denominator instead of the shared one, which looks
 * heterogeneous at face value but is structurally still one table. Returns
 * `null` — never a guess — when any of that doesn't hold:
 *
 *   - A large or non-integer LCM is itself evidence these are NOT one table
 *     (Zulrah's mutagen rows, whose own raritynotes describe a genuine
 *     two-stage roll; Vorkath's fletching materials, where 150 does not
 *     evenly divide 2730), not a reason to force one anyway.
 *   - Rescaled weights exceeding the merged denominator is a DIRECT proof
 *     of that, not just a ratio heuristic: Gemstone Crab's seven gem
 *     entries already sum to exactly their own denominator (32/32, no
 *     `nothing` slack) before Uncut dragonstone's 1/500 is even
 *     considered, so there is no room left for it in the same weighted
 *     pool — merging anyway would silently overflow (caught once already,
 *     the hard way, by `weights_sum` reporting `4008` against a `4000`
 *     denominator before this check existed). Checked here so a bad merge
 *     never reaches that check in the first place, rather than relying on
 *     it as a safety net after the fact.
 */
function tryHomogenizeDenominators(rates: readonly ParsedRate[]): number | null {
  const fixed = rates.filter((r) => r.kind === 'fixed')
  const denominators = fixed.map((r) => r.den)
  if (denominators.length === 0 || denominators.some((d) => !Number.isInteger(d) || d <= 0)) return null
  const merged = denominators.reduce((a, b) => lcm(a, b))
  if (!Number.isFinite(merged)) return null
  const maxDenominator = Math.max(...denominators)
  if (merged > maxDenominator * LCM_MERGE_RATIO_CAP) return null
  const totalWeight = fixed.reduce((sum, rate) => sum + (rate.num * merged) / rate.den, 0)
  if (totalWeight > merged + 1e-9) return null
  return merged
}

/** Phrases the wiki uses in `raritynotes` to describe a shared, mutually-exclusive roll across several rows. */
const MUTUAL_EXCLUSIVITY_PHRASES = [
  /\bany\s+\S+\s+piece\b/i, // "the drop rate is ... for a specific piece, or 1/127 for any piece" (GWD generals)
  /\btradeable unique table\b/i, // "must roll an invisible 1/N drop on the tradeable unique table" (DT2 bosses)
  /\bmutually[- ]exclusive\b/i,
  /\bat most one\b/i,
  /\bonly one\b/i,
  /\bone of (?:the|these)\b/i,
  /\breceive one\b/i,
] as const

/** Every `<ref name="X">` / `{{NamedRef|X}}` reference name a `raritynotes` string cites. */
function citedRefNames(rarityNotes: string): string[] {
  const names: string[] = []
  for (const m of rarityNotes.matchAll(/<ref[^>]*\bname\s*=\s*"?([\w-]+)"?[^>]*>/gi)) {
    if (m[1] !== undefined) names.push(m[1])
  }
  for (const m of rarityNotes.matchAll(/\{\{NamedRef\|(?:name=)?([\w-]+)/gi)) {
    if (m[1] !== undefined) names.push(m[1])
  }
  return names
}

/**
 * Looks for wiki text that confirms a heterogeneous-denominator heading's
 * entries genuinely share one mutually-exclusive roll (`preroll`), instead
 * of guessing from the heading text or rarities alone (PROJECT_PLAN.md 6.5
 * heuristic 6). Two independent signals, either sufficient alone:
 *
 *   - Two or more entries cite the SAME named footnote
 *     (`<ref name="news"/>`, `{{NamedRef|Halberd}}`) — confirmed against
 *     real cases: Callisto/Vet'ion/Artio/Calvar'ion/Spindel/Venenatis'
 *     "Unique(s)" entries all cite one shared "Poll 78" news post
 *     explaining the group's combined drop mechanic.
 *   - Any entry's `raritynotes` contains an explicit mutual-exclusivity
 *     phrase — confirmed against Duke Sucellus/The Leviathan/The
 *     Whisperer/Vardorvis ("the tradeable unique table") and General
 *     Graardor/Kree'arra ("any piece").
 *
 * Deliberately NOT a signal: the heading text itself ("Unique"/"Uniques").
 * That was checked and rejected two sessions ago — only 2 of 10 bosses
 * carrying that heading confirm mutual exclusivity in prose, so the heading
 * alone is not reliable (see docs/DECISIONS.md). Returns `null` — leave the
 * group flagged — when neither signal fires; a source with a real but
 * undiscovered mechanic (The Nightmare's Uniques, no citation at all) stays
 * `needs_review` rather than being guessed into `verified`.
 */
function findConfirmingSignal(lines: readonly WikitextDropLine[]): string | null {
  const refCounts = new Map<string, number>()
  for (const line of lines) {
    for (const name of citedRefNames(line.rarityNotes)) {
      refCounts.set(name, (refCounts.get(name) ?? 0) + 1)
    }
  }
  const sharedRef = [...refCounts.entries()].find(([, count]) => count >= 2)
  if (sharedRef !== undefined) {
    const [refName, count] = sharedRef
    return `${count} entries cite the same footnote ('${refName}')`
  }

  for (const line of lines) {
    for (const phrase of MUTUAL_EXCLUSIVITY_PHRASES) {
      const match = phrase.exec(line.rarityNotes)
      if (match !== null) {
        return `raritynotes on '${line.name}' says "${match[0]}"`
      }
    }
  }

  return null
}

interface ResolvedLine {
  line: WikitextDropLine
  resolution: RarityResolution
}

/**
 * When one denominator accounts for MOST of a block's entries and a small
 * number of outliers sit at a different denominator that doesn't homogenise
 * with it (`tryHomogenizeDenominators` already failed by the time this
 * runs), splits the block into the dominant pool (`weighted`) and the
 * outliers (`independent`) instead of forcing everything into one table or
 * leaving the whole block flagged. Two real shapes need this:
 *
 *   - Hespori's "Main table": 32 seeds sharing denominator 80, plus
 *     Bottomless compost bucket at 1/35 and Tangleroot at 1/5375 — neither
 *     remotely the same scale as the seed pool (note Bottomless compost
 *     bucket, at 1/35, is actually a MORE common roll than several
 *     individual seeds; "outlier" here means "doesn't share the pool's
 *     denominator," not "rarer" — an earlier version of this function
 *     wrongly required outliers to have a larger denominator and missed
 *     this exact case).
 *   - Gemstone Crab's "Drops": 7 gems that already sum to exactly their
 *     own denominator (32/32, no `nothing` slack) before Uncut
 *     dragonstone's 1/500 is even considered — `tryHomogenizeDenominators`
 *     correctly refuses this merge (no room), and the right structural
 *     reading is that dragonstone is a separate, independent rare roll,
 *     not a competing option in the same draw.
 *
 * Deliberately conservative: requires at least 3 entries in the dominant
 * group (so two same-denominator entries plus one outlier doesn't count —
 * too little evidence of a real "pool") and at most 2 outliers.
 */
function trySplitDominantAndOutliers(
  resolved: readonly ResolvedLine[]
): { dominant: ResolvedLine[]; dominantDenominator: number; outliers: ResolvedLine[] } | null {
  const fixed = resolved.filter((r) => r.resolution.rate?.kind === 'fixed')
  if (fixed.length !== resolved.length) return null

  const counts = new Map<number, number>()
  for (const r of fixed) {
    const den = (r.resolution.rate as { den: number }).den
    counts.set(den, (counts.get(den) ?? 0) + 1)
  }
  let dominantDenominator: number | null = null
  let dominantCount = 0
  for (const [den, count] of counts) {
    if (count > dominantCount) {
      dominantDenominator = den
      dominantCount = count
    }
  }
  if (dominantDenominator === null) return null

  const outlierCount = resolved.length - dominantCount
  if (dominantCount < 3 || outlierCount === 0 || outlierCount > 2) return null

  const dominant = fixed.filter((r) => (r.resolution.rate as { den: number }).den === dominantDenominator)
  const outliers = fixed.filter((r) => (r.resolution.rate as { den: number }).den !== dominantDenominator)

  return { dominant, dominantDenominator, outliers }
}

/** Parses `5/139` into a probability; null for anything else. */
function parseFraction(text: string): number | null {
  const match = /^~?\s*([\d,.]+)\s*\/\s*([\d,.]+)\s*$/.exec(text.trim())
  if (match === null) return null
  const num = Number(match[1]?.replace(/,/g, ''))
  const den = Number(match[2]?.replace(/,/g, ''))
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return null
  return num / den
}

/**
 * Published rarities are rounded to one decimal place in the denominator
 * (`1/416.7`), so a real partition's rates sum to the access rate only to
 * within that rounding. Measured spread across the corpus is under 0.3%; 1%
 * leaves room without admitting anything that is not a partition — the nearest
 * non-partition measured is Vorkath at 66.7% over.
 */
const PARTITION_TOLERANCE = 0.01

/**
 * Runs the access-rate identity on a heading block. Returns null when the
 * block did not come entirely from one transclusion, which is every
 * hand-written block on the wiki.
 */
export function transclusionPartition(
  lines: readonly WikitextDropLine[],
  rates: readonly ParsedRate[]
): PartitionCheck | null {
  if (lines.length === 0) return null
  const template = lines[0]?.expandedFrom ?? ''
  if (template === '') return null
  // Every row must come from the SAME transclusion. A block mixing a
  // transcluded sub-table with rows written directly on the page is not that
  // sub-table, and its sum would not mean anything.
  if (!lines.every((line) => line.expandedFrom === template)) return null

  const accessRate = lines[0]?.accessRate ?? ''
  const access = parseFraction(accessRate)
  const sum = rates.reduce((total, rate) => total + (rate.kind === 'fixed' ? rate.num / rate.den : 0), 0)

  if (access === null || access === 0) {
    return { template, accessRate, sum, ratio: NaN, verdict: 'no-access-rate' }
  }
  const ratio = sum / access
  return {
    template,
    accessRate,
    sum,
    ratio,
    verdict: Math.abs(ratio - 1) <= PARTITION_TOLERANCE ? 'partition' : 'not-a-partition',
  }
}

/** One clause describing what the identity found, for `notes` and reasons. */
export function describePartition(check: PartitionCheck): string {
  switch (check.verdict) {
    case 'partition':
      return (
        `, whose rates sum to its stated access rate ${check.accessRate} ` +
        `(ratio ${check.ratio.toFixed(4)}), so its rows are one mutually-exclusive roll`
      )
    case 'not-a-partition':
      return (
        `, whose rates sum to ${check.ratio.toFixed(4)}x its stated access rate ${check.accessRate} — ` +
        `so they are NOT a clean partition of that roll and something on the page overrides them`
      )
    case 'no-access-rate':
      return ' , which declares no access rate, so the partition identity has nothing to test'
  }
}

/**
 * Runs the identity on EVERY block that came from a transclusion, whatever
 * mode that block ends up in, so the result is a standing check rather than a
 * one-off measurement. `parse-boss.ts` reports any block whose rows do not sum
 * to their own access rate.
 */
export function checkTransclusionPartitions(blocks: readonly HeadingBlock[]): PartitionCheck[] {
  const checks: PartitionCheck[] = []
  for (const block of blocks) {
    const rates = block.lines
      .map((line) => parseRarity(line.rarity).rate)
      .filter((rate): rate is ParsedRate => rate !== null)
    if (rates.length !== block.lines.length) continue
    const check = transclusionPartition(block.lines, rates)
    if (check !== null) checks.push(check)
  }
  return checks
}

const INDEPENDENT_HEADINGS = /tertiary|secondary/i
const PREROLL_HEADINGS = /pre-?roll/i
const ALWAYS_HEADINGS = /^100%$|^always$/i

export interface HeadingBlock {
  heading: string
  /** Shared by every line in the block — `groupByHeading` keys on `(section, heading)`. */
  section: string
  lines: WikitextDropLine[]
}

/** Join character for the (section, heading) grouping key — never appears in wiki heading text. */
const GROUP_KEY_SEP = ' '

/**
 * Groups extracted lines by heading, preserving document order. Keyed by
 * `(section, heading)`, not `heading` alone: a page with more than one
 * top-level Drops section (The Mimic's Elite/Master split, Scurrius'
 * MVP/non-MVP split) can have two sections that each use the same
 * sub-heading name — both have `===Tertiary===` — and those must stay two
 * distinct groups, not merge into one table mixing rates that were never
 * meant to share a denominator or mode. `line.section` is `''` for the
 * common single-section page, so this reduces to the old heading-only
 * grouping there. The returned `HeadingBlock.heading` stays the raw,
 * unqualified sub-heading text — `build-tables.ts`'s mode-inference regexes
 * (`INDEPENDENT_HEADINGS` etc.) match against it and must keep working
 * whether or not the page has multiple sections.
 */
export function groupByHeading(lines: readonly WikitextDropLine[]): HeadingBlock[] {
  const order: string[] = []
  const byKey = new Map<string, { heading: string; section: string; lines: WikitextDropLine[] }>()
  for (const line of lines) {
    const key = `${line.section}${GROUP_KEY_SEP}${line.heading}`
    if (!byKey.has(key)) {
      byKey.set(key, { heading: line.heading, section: line.section, lines: [] })
      order.push(key)
    }
    byKey.get(key)!.lines.push(line)
  }
  return order.map((key) => byKey.get(key)!)
}

/**
 * Builds table groups from heading blocks. Weighted-shaped adjacent headings
 * sharing a denominator are merged into one group; everything else stands on
 * its own heading.
 */
export function buildTableGroups(blocks: readonly HeadingBlock[]): ParsedTableGroup[] {
  const groups: ParsedTableGroup[] = []
  let pendingWeighted: {
    denominator: number
    headings: string[]
    section: string
    entries: ParsedEntry[]
  } | null = null

  const flushWeighted = (): void => {
    if (pendingWeighted === null) return
    groups.push({
      mode: 'weighted',
      headings: pendingWeighted.headings,
      section: pendingWeighted.section,
      denominator: pendingWeighted.denominator,
      entries: pendingWeighted.entries,
      ambiguous: null,
    })
    pendingWeighted = null
  }

  for (const block of blocks) {
    const resolved = block.lines.map((line) => ({ line, resolution: parseRarity(line.rarity) }))

    if (resolved.some(({ resolution }) => resolution.rate === null)) {
      flushWeighted()
      groups.push({
        mode: 'weighted',
        headings: [block.heading],
        section: block.section,
        denominator: null,
        entries: [],
        ambiguous: `unparseable rarity in "${block.heading}": ${resolved
          .filter((r) => r.resolution.rate === null)
          .map((r) =>
            r.resolution.unknownTemplate !== undefined
              ? `${r.line.name}: unrecognised rarity template '${r.resolution.unknownTemplate}' (raw '${r.line.rarity}')`
              : `${r.line.name}='${r.line.rarity}'`
          )
          .join(', ')}`,
      })
      continue
    }

    const allAlways =
      resolved.every(({ resolution }) => resolution.rate?.kind === 'always') ||
      ALWAYS_HEADINGS.test(block.heading)
    if (allAlways) {
      flushWeighted()
      groups.push({
        mode: 'always',
        headings: [block.heading],
        section: block.section,
        denominator: null,
        entries: resolved.map(({ line, resolution }) =>
          toEntry(line, resolution.rate!, null, resolution.conditions)
        ),
        ambiguous: null,
      })
      continue
    }

    if (INDEPENDENT_HEADINGS.test(block.heading)) {
      flushWeighted()
      groups.push({
        mode: 'independent',
        headings: [block.heading],
        section: block.section,
        denominator: null,
        entries: resolved.map(({ line, resolution }) =>
          toEntry(line, resolution.rate!, null, resolution.conditions)
        ),
        ambiguous: null,
      })
      continue
    }

    // Heading text is checked BEFORE inferring from denominator shape. A
    // pre-roll's rows can coincidentally share one denominator (Brutus' real
    // pre-roll is 5/150, 4/150, 1/150, all /150), which would otherwise look
    // exactly like a weighted table and get silently misclassified.
    if (PREROLL_HEADINGS.test(block.heading)) {
      flushWeighted()

      // A "Pre-roll" heading can still interleave a guaranteed row with the
      // real chance-based ones — Monumental chest's Cabbage/Message rows are
      // "Always" (a consolation prize for 0-contribution players) sitting
      // beside the unique-selection table. `preroll`'s schema rightly rejects
      // `always` entries: unlike `independent` (where an inline `always` is
      // safe — see landmine #4), `preroll` is CHECKED IN ORDER with the first
      // hit short-circuiting everything after it, so an `always` entry would
      // deterministically win every single kill and make every later entry
      // (including the real unique pool) unreachable. Splitting it into its
      // own `always` table, evaluated unconditionally rather than as a
      // competing step in the ordered chain, is correct instead of merely
      // schema-legal.
      const alwaysRows = resolved.filter(({ resolution }) => resolution.rate?.kind === 'always')
      const fixedRows = resolved.filter(({ resolution }) => resolution.rate?.kind === 'fixed')
      if (alwaysRows.length > 0) {
        groups.push({
          mode: 'always',
          headings: [block.heading],
          section: block.section,
          denominator: null,
          entries: alwaysRows.map(({ line, resolution }) =>
            toEntry(line, resolution.rate!, null, resolution.conditions)
          ),
          ambiguous: null,
        })
      }

      // What's left may still not be a genuine preroll. `preroll` means
      // "checked in order, chance nothing hits and the chain continues" — a
      // real one (Brutus: 5/150, 4/150, 1/150) does NOT sum to its shared
      // denominator, because that shortfall IS the "nothing" that lets later
      // tables still run. Rows that DO reconcile flush to one shared
      // denominator (Monumental chest's uniques: 8+2+2+2+2+2+1 = 19) are a
      // `weighted` selection the wiki happens to label by WHEN it resolves
      // ("pre-roll" in the raid's timeline) rather than by HOW it behaves —
      // treating that as `preroll` would silently apply first-hit-wins
      // Bernoulli semantics to numbers the wiki computed as a normalised
      // weighted split, giving every row a materially wrong probability.
      const fixedDenominators = new Set(
        fixedRows.map(({ resolution }) => (resolution.rate!.kind === 'fixed' ? resolution.rate!.den : null))
      )
      const sharedDenominator = fixedDenominators.size === 1 ? [...fixedDenominators][0]! : null
      const reconcilesFlat =
        sharedDenominator !== null &&
        fixedRows.reduce((sum, { resolution }) => sum + resolution.rate!.num, 0) === sharedDenominator

      groups.push({
        mode: reconcilesFlat ? 'weighted' : 'preroll',
        headings: [block.heading],
        section: block.section,
        denominator: reconcilesFlat ? sharedDenominator : null,
        entries: fixedRows.map(({ line, resolution }) =>
          toEntry(line, resolution.rate!, reconcilesFlat ? sharedDenominator : null, resolution.conditions)
        ),
        ambiguous: null,
      })
      continue
    }

    const denominators = new Set(
      resolved
        .map(({ resolution }) => (resolution.rate?.kind === 'fixed' ? resolution.rate.den : null))
        .filter((d) => d !== null)
    )

    // Homogeneous denominators are the fast, exact path (no rescaling).
    // Heterogeneous ones get one more chance before falling back to a
    // preroll guess: `tryHomogenizeDenominators` checks whether they're a
    // clean multiple of one shared denominator (heuristic 1, generalised —
    // see its own doc comment), which is a real structural signal, not a
    // guess.
    const homogenizedDenominator =
      denominators.size === 1
        ? [...denominators][0]!
        : tryHomogenizeDenominators(resolved.map((r) => r.resolution.rate!))

    if (homogenizedDenominator !== null) {
      const entries = resolved.map(({ line, resolution }) =>
        toEntry(line, resolution.rate!, homogenizedDenominator, resolution.conditions)
      )
      // Same section required to merge, not just the same denominator — two
      // blocks that happen to share a denominator across a SECTION boundary
      // (Obor/Bryophyta's Members/Free-to-play split) must not fold into one
      // group, or the fallback membership condition below would have no
      // single section to attribute the merged table to and would silently
      // pick one side. Latent risk, not yet observed in the corpus (no two
      // adjacent cross-section blocks currently share a denominator) — closed
      // here because this is the same section-tracking work, not a separate fix.
      if (
        pendingWeighted !== null &&
        pendingWeighted.denominator === homogenizedDenominator &&
        pendingWeighted.section === block.section
      ) {
        pendingWeighted.headings.push(block.heading)
        pendingWeighted.entries.push(...entries)
      } else {
        flushWeighted()
        pendingWeighted = {
          denominator: homogenizedDenominator,
          headings: [block.heading],
          section: block.section,
          entries,
        }
      }
      continue
    }

    // Still heterogeneous: try peeling off a small number of much-rarer
    // outliers from one dominant denominator (`trySplitDominantAndOutliers`)
    // before falling back to a guess.
    const split = trySplitDominantAndOutliers(resolved)
    if (split !== null) {
      flushWeighted()
      const dominantEntries = split.dominant.map(({ line, resolution }) =>
        toEntry(line, resolution.rate!, split.dominantDenominator, resolution.conditions)
      )
      groups.push({
        mode: 'weighted',
        headings: [block.heading],
        section: block.section,
        denominator: split.dominantDenominator,
        entries: dominantEntries,
        ambiguous: null,
        confirmedBy: `${split.dominant.length} of ${resolved.length} entries share denominator ${split.dominantDenominator}; ${split.outliers.length} rarer outlier(s) split into their own independent table`,
      })
      const outlierEntries = split.outliers.map(({ line, resolution }) =>
        toEntry(line, resolution.rate!, null, resolution.conditions)
      )
      groups.push({
        mode: 'independent',
        headings: [`${block.heading} (outliers)`],
        section: block.section,
        denominator: null,
        entries: outlierEntries,
        ambiguous: null,
        confirmedBy: `rarer than the ${split.dominant.length}-entry /${split.dominantDenominator} pool in "${block.heading}"; modelled as separate independent rolls`,
      })
      continue
    }

    // Heterogeneous denominators that don't even homogenise or split, nothing
    // Always, heading text gives no hint (the "Pre-roll" case was already
    // handled above): this is either a preroll (mutually exclusive) chain
    // or a set of independent fixed rolls, and the rarities alone cannot
    // say which. One more signal before giving up: wiki prose sometimes
    // confirms it directly (`findConfirmingSignal`) — a shared footnote
    // citation across entries, or explicit "any piece"/"tradeable unique
    // table" language. Only when that ALSO comes up empty does this stay a
    // flagged guess, per heuristic 6.
    flushWeighted()
    const confirmedBy = findConfirmingSignal(block.lines)
    const partition = transclusionPartition(
      block.lines,
      resolved.map((r) => r.resolution.rate!)
    )
    const entries = resolved.map(({ line, resolution }) =>
      toEntry(line, resolution.rate!, null, resolution.conditions)
    )

    // A confirmed partition is modelled as `independent`, NOT `preroll`, and
    // the difference is measurable rather than stylistic.
    //
    // Both modes get the block's own rows right — they are disjoint, so a
    // first-hit-wins chain and a set of independent rolls give identical
    // marginals inside the block. They differ in what they claim about
    // everything AFTER the block: `preroll` suppresses every later weighted
    // and preroll table, and nothing in the identity licenses that. Measured
    // against the wiki's own published rates, that suppression is simply
    // wrong — it put Arrg's Coal 23.45% under its stated 1/42.7, Giant sea
    // snake's Adamant dart tip 13.83% under, Abyssal Sire's Earth orb 4.50%
    // under. As `independent`, every one of those lands exactly on the stated
    // figure.
    //
    // The cost is that two rows of one sub-table can co-occur in a single
    // simulated kill, which the real access roll forbids: about 0.06% of kills
    // on Abyssal Sire. That is the same quantified, documented kill-log
    // artifact the CoX decision already accepts, and it is confined to the
    // block instead of distorting its neighbours.
    //
    // `apps/ingest/test/marginal-rates.test.ts` is what caught this and is
    // what keeps it caught.
    // The mode switch is driven by the block coming entirely from ONE
    // transclusion — that is what makes `preroll`'s suppression of later
    // tables unsupportable. The identity is the evidence recorded alongside
    // it, and it is what says whether the rows are additionally a clean
    // partition of the declared access rate.
    if (partition !== null) {
      groups.push({
        mode: 'independent',
        headings: [block.heading],
        section: block.section,
        denominator: null,
        entries,
        // Still flagged. The identity proves the rows are ONE roll; modelling
        // them as independent rolls is a deliberate approximation of that, and
        // the document does not express the single-access-roll shape at all.
        // Clearing this would claim the pipeline derived the structure
        // unaided, which is not what happened.
        ambiguous:
          `heading "${block.heading}" is the transcluded sub-table {{${partition.template}}}` +
          `${describePartition(partition)}. Modelled as independent rolls to preserve the wiki's per-row ` +
          `rates; the single-access-roll shape itself is not modelled and needs a human check`,
        confirmedBy:
          `${entries.length} entries expanded from one {{${partition.template}}} transclusion` +
          describePartition(partition),
        partition,
      })
      continue
    }

    groups.push({
      mode: 'preroll',
      headings: [block.heading],
      section: block.section,
      denominator: null,
      entries,
      ambiguous:
        confirmedBy !== null
          ? null
          : `heading "${block.heading}" has entries at different denominators and is not ` +
            `named Pre-roll/Tertiary/Secondary; assumed mutually-exclusive (preroll) but ` +
            `this is a guess and needs a human check`,
      ...(confirmedBy !== null ? { confirmedBy } : {}),
      ...(partition !== null ? { partition } : {}),
    })
  }

  flushWeighted()
  return groups
}
