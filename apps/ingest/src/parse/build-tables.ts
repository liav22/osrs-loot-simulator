import { ALWAYS_RARITY, FRACTION_RARITY } from '../wiki/fields.js'
import type { WikitextDropLine } from './wikitext-drops.js'

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
}

export type ParsedMode = 'always' | 'preroll' | 'weighted' | 'independent'

export interface ParsedTableGroup {
  mode: ParsedMode
  headings: string[]
  denominator: number | null
  entries: ParsedEntry[]
  /** Set when the group's shape does not cleanly fit any mode. */
  ambiguous: string | null
}

function parseRarity(rarity: string): ParsedRate | null {
  const trimmed = rarity.trim()
  if (ALWAYS_RARITY.test(trimmed)) return { kind: 'always', num: 1, den: 1 }
  const match = FRACTION_RARITY.exec(trimmed)
  if (match === null) return null
  const num = Number(match[1]?.replace(/,/g, ''))
  const den = Number(match[2]?.replace(/,/g, ''))
  if (!Number.isFinite(num) || !Number.isFinite(den) || den <= 0) return null
  return { kind: 'fixed', num, den }
}

function toEntry(line: WikitextDropLine, rate: ParsedRate, denominator: number | null): ParsedEntry {
  return {
    name: line.name,
    quantity: line.quantity,
    noted: line.noted,
    members: line.members,
    freeToPlay: line.freeToPlay,
    rarity: rate,
    weight: denominator === null ? null : rate.num,
  }
}

const INDEPENDENT_HEADINGS = /tertiary|secondary/i
const PREROLL_HEADINGS = /pre-?roll/i
const ALWAYS_HEADINGS = /^100%$|^always$/i

export interface HeadingBlock {
  heading: string
  lines: WikitextDropLine[]
}

/** Groups extracted lines by heading, preserving document order. */
export function groupByHeading(lines: readonly WikitextDropLine[]): HeadingBlock[] {
  const order: string[] = []
  const byHeading = new Map<string, WikitextDropLine[]>()
  for (const line of lines) {
    if (!byHeading.has(line.heading)) {
      byHeading.set(line.heading, [])
      order.push(line.heading)
    }
    byHeading.get(line.heading)!.push(line)
  }
  return order.map((heading) => ({ heading, lines: byHeading.get(heading)! }))
}

/**
 * Builds table groups from heading blocks. Weighted-shaped adjacent headings
 * sharing a denominator are merged into one group; everything else stands on
 * its own heading.
 */
export function buildTableGroups(blocks: readonly HeadingBlock[]): ParsedTableGroup[] {
  const groups: ParsedTableGroup[] = []
  let pendingWeighted: { denominator: number; headings: string[]; entries: ParsedEntry[] } | null =
    null

  const flushWeighted = (): void => {
    if (pendingWeighted === null) return
    groups.push({
      mode: 'weighted',
      headings: pendingWeighted.headings,
      denominator: pendingWeighted.denominator,
      entries: pendingWeighted.entries,
      ambiguous: null,
    })
    pendingWeighted = null
  }

  for (const block of blocks) {
    const rates = block.lines.map((line) => ({ line, rate: parseRarity(line.rarity) }));

    if (rates.some(({ rate }) => rate === null)) {
      flushWeighted()
      groups.push({
        mode: 'weighted',
        headings: [block.heading],
        denominator: null,
        entries: [],
        ambiguous: `unparseable rarity in "${block.heading}": ${rates
          .filter((r) => r.rate === null)
          .map((r) => `${r.line.name}='${r.line.rarity}'`)
          .join(', ')}`,
      })
      continue
    }

    const allAlways =
      rates.every(({ rate }) => rate?.kind === 'always') ||
      ALWAYS_HEADINGS.test(block.heading)
    if (allAlways) {
      flushWeighted()
      groups.push({
        mode: 'always',
        headings: [block.heading],
        denominator: null,
        entries: rates.map(({ line, rate }) => toEntry(line, rate!, null)),
        ambiguous: null,
      })
      continue
    }

    if (INDEPENDENT_HEADINGS.test(block.heading)) {
      flushWeighted()
      groups.push({
        mode: 'independent',
        headings: [block.heading],
        denominator: null,
        entries: rates.map(({ line, rate }) => toEntry(line, rate!, null)),
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
      groups.push({
        mode: 'preroll',
        headings: [block.heading],
        denominator: null,
        entries: rates.map(({ line, rate }) => toEntry(line, rate!, null)),
        ambiguous: null,
      })
      continue
    }

    const denominators = new Set(
      rates.map(({ rate }) => (rate?.kind === 'fixed' ? rate.den : null)).filter((d) => d !== null)
    )

    if (denominators.size === 1) {
      const [denominator] = [...denominators]
      const entries = rates.map(({ line, rate }) => toEntry(line, rate!, denominator!))
      if (pendingWeighted !== null && pendingWeighted.denominator === denominator) {
        pendingWeighted.headings.push(block.heading)
        pendingWeighted.entries.push(...entries)
      } else {
        flushWeighted()
        pendingWeighted = { denominator: denominator!, headings: [block.heading], entries }
      }
      continue
    }

    // Heterogeneous denominators, nothing Always, heading text gives no hint
    // (the "Pre-roll" case was already handled above): this is either a
    // preroll (mutually exclusive) chain or a set of independent fixed
    // rolls, and the rarities alone cannot say which — e.g. the wilderness
    // bosses' "Unique" tables ("at most one item from this table is
    // dropped") behave like preroll but the heading carries no keyword.
    flushWeighted()
    groups.push({
      mode: 'preroll',
      headings: [block.heading],
      denominator: null,
      entries: rates.map(({ line, rate }) => toEntry(line, rate!, null)),
      ambiguous:
        `heading "${block.heading}" has entries at different denominators and is not ` +
        `named Pre-roll/Tertiary/Secondary; assumed mutually-exclusive (preroll) but ` +
        `this is a guess and needs a human check`,
    })
  }

  flushWeighted()
  return groups
}
