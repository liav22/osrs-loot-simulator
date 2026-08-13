import { FRACTION_RARITY } from '../wiki/fields.js'
import { findDropsSections, findTemplateCalls, parseTemplateCall } from './wikitext-drops.js'

/**
 * A boss's access into the shared rare/gem drop tables (PROJECT_PLAN.md 6.5
 * heuristic 4) is declared through `{{RareDropTable|...}}` / `{{GemDropTable
 * |...}}` / `{{GWDRDT}}` — a completely different template family from
 * `{{DropsLine}}`. These templates don't list items at all (the RDT/gem/
 * mega-rare CONTENTS live once in `data/tables/`, not per-boss); they only
 * declare this boss's ACCESS RATE into those shared tables, which
 * `{{#invoke:RareDropLines|main}}` expands into the standard item rows at
 * render time — invisible in the raw wikitext, and not this parser's
 * problem, since `data/tables/rare_drop_table.json` already has that
 * content.
 *
 * Confirmed against the live template definitions
 * (`data/snapshots/wikitext/template-*.json`), not guessed from call sites:
 * - `{{RareDropTable|R|G?|...}}`: param 1 is the RDT access rate; an
 *   optional param 2 is a SEPARATE, independent direct gem-table access rate
 *   (`{{#if:{{{2|}}}|There is also a ... chance of rolling the gem drop
 *   table.}}` in the template body) — not part of the RDT's own internal
 *   20/128 sub-chance. "Rare and Gem drop table" headings (Giant Mole, King
 *   Black Dragon, the Dagannoth Kings, Crazy archaeologist, Black demon) use
 *   this two-rate form.
 * - `{{GemDropTable|G|...}}`: param 1 is a direct gem-table access rate,
 *   with no RDT access at all.
 * - `{{GWDRDT}}` takes no parameters — it transcludes to prose citing a
 *   totally distinct "God Wars Dungeon-variant rare/gem drop table" (its own
 *   page, own composition: rune sword instead of runite bar, no
 *   ring-of-wealth effect, mega-rare items folded in directly). Not the same
 *   table as `data/tables/rare_drop_table.json`, and out of scope for the
 *   three tables built this session — flagged, not guessed at.
 * - `rolls=N` (present on both templates): repeated ACCESS attempts, N
 *   independent Bernoulli rolls at the stated rate — the same meaning
 *   `Table.rolls` already has everywhere else (Zulrah's main table is
 *   `rolls: 2` the same way, per PROJECT_PLAN.md 4.6). Corporeal Beast is a
 *   confirmed, textual exception: its own `override=` prose reads "a 12/512
 *   chance of rolling the gem drop table, whereupon its contents are rolled
 *   10 times" — access checked ONCE, the sub-table drawn 10 times after.
 *   Now modelled, via `TableRefNode.drawsPerHit`, and detected from that
 *   prose rather than from the boss's identity — see `DRAWS_PER_HIT_PROSE`.
 * - `dropversion=X` scopes the access line to boss variant X, mapped to a
 *   `variant` condition.
 * - `naturetalisman=`/`chaostalisman=` are pure wiki categorisation flags —
 *   neither template's rendering logic reads them for anything. Not modelled.
 * - `multiplier=N` (RareDropTable only) scales the QUANTITY of whatever the
 *   RDT yields. Now modelled, via `TableRefNode.qtyMultiplier`, which scales
 *   one specific ACCESS without touching the shared, unscaled
 *   `data/tables/rare_drop_table.json` record the ~17 other tier-C sources
 *   reference plainly. Abyssal Sire (`multiplier=2`) is the one source that
 *   has it — confirmed by scanning every wikitext snapshot's RDT/gem template
 *   calls, not assumed from the one known case.
 * - `approx=Yes` marks the stated rate itself as an approximation rather
 *   than a confirmed exact constant — recorded, not gated on.
 */

const RDT_ACCESS_TEMPLATES = ['RareDropTable', 'GemDropTable', 'GWDRDT'] as const

/**
 * The wiki's own phrasing for "one access check, then K draws" — the reading
 * that inverts `rolls=N`'s usual meaning. Matched against the template's
 * `override=` prose, which is where the wiki states the mechanic in words.
 *
 * This is a TEXTUAL signal, deliberately, and it is the only thing that
 * distinguishes the two readings: `rolls=10` alone is structurally identical
 * to the five `rolls=2` access lines elsewhere in the corpus that genuinely
 * do mean repeated access attempts. Reading the prose is the same class of
 * signal `build-tables.ts`'s `findConfirmingSignal` already uses on
 * `raritynotes` — and the alternative (keying off the boss's slug) is exactly
 * the per-boss branch CLAUDE.md's hard rule forbids.
 *
 * Scanned across every wikitext snapshot: this phrase occurs on exactly one
 * page (Corporeal Beast), and the only other "whereupon" in the corpus
 * (Inferno) is unrelated combat prose, not inside an access template.
 */
const DRAWS_PER_HIT_PROSE = /whereupon (?:its|their) contents are rolled (\d+) times/i

export interface RdtAccessLine {
  /** Which shared table this line grants access to. */
  ref: 'rare_drop_table' | 'gem_drop_table'
  rate: { num: number; den: number }
  /** Independent access attempts. Always 1 when `drawsPerHit` is set — the two readings are mutually exclusive. */
  rolls: number
  variant: string | null
  approx: boolean
  /** `multiplier=N`: scales the quantity this access yields (`TableRefNode.qtyMultiplier`). */
  qtyMultiplier: number | null
  /** One access check gating K draws (`TableRefNode.drawsPerHit`), per the wiki's own prose. */
  drawsPerHit: number | null
  raw: string
}

export interface UnresolvedRdtAccess {
  reason: string
  raw: string
}

export interface RdtAccessResult {
  lines: RdtAccessLine[]
  unresolved: UnresolvedRdtAccess[]
}

function parseFraction(raw: string): { num: number; den: number } | null {
  const match = FRACTION_RARITY.exec(raw.trim())
  if (match === null) return null
  const num = Number(match[1]?.replace(/,/g, ''))
  const den = Number(match[2]?.replace(/,/g, ''))
  if (!Number.isFinite(num) || !Number.isFinite(den) || den <= 0) return null
  return { num, den }
}

function accessLineFor(
  ref: 'rare_drop_table' | 'gem_drop_table',
  rawRate: string,
  params: ReadonlyMap<string, string>,
  raw: string
): RdtAccessLine | UnresolvedRdtAccess {
  const rate = parseFraction(rawRate)
  if (rate === null) {
    return { reason: `RDT/gem-table access rate could not be read from the row: '${rawRate}'`, raw }
  }
  const rollsRaw = params.get('rolls')
  const rolls = rollsRaw === undefined ? 1 : Number(rollsRaw)
  if (!Number.isInteger(rolls) || rolls < 1) {
    return { reason: `RDT/gem-table access has a non-integer or non-positive 'rolls' value: '${rollsRaw}'`, raw }
  }
  const multiplierRaw = params.get('multiplier')
  const multiplier = multiplierRaw === undefined ? null : Number(multiplierRaw)
  if (multiplier !== null && (!Number.isFinite(multiplier) || multiplier <= 0)) {
    return { reason: `RDT/gem-table access has a non-positive 'multiplier' value: '${multiplierRaw}'`, raw }
  }

  // "whereupon its contents are rolled N times" inverts what `rolls=N` means
  // for this one access line. The two readings are mutually exclusive, so the
  // access collapses to a single attempt and the count moves to `drawsPerHit`.
  const prose = DRAWS_PER_HIT_PROSE.exec(params.get('override') ?? '')
  const drawsPerHit = prose === null ? null : Number(prose[1])
  if (drawsPerHit !== null) {
    if (!Number.isInteger(drawsPerHit) || drawsPerHit < 1) {
      return { reason: `RDT/gem-table access prose states a non-positive draw count: '${prose?.[0]}'`, raw }
    }
    // The prose and the parameter must agree. If a page ever states one count
    // in words and another in `rolls=`, that is a genuine ambiguity about
    // which the wiki means — flag it rather than silently pick one.
    if (rolls !== drawsPerHit) {
      return {
        reason:
          `RDT/gem-table access states "rolled ${drawsPerHit} times" in prose but has rolls=${rolls}; ` +
          'the two readings disagree and were not guessed between',
        raw,
      }
    }
  }

  return {
    ref,
    rate,
    rolls: drawsPerHit === null ? rolls : 1,
    variant: params.get('dropversion') ?? null,
    approx: (params.get('approx') ?? '').toLowerCase() === 'yes',
    qtyMultiplier: multiplier !== null && multiplier !== 1 ? multiplier : null,
    drawsPerHit,
    raw,
  }
}

/**
 * Scoped to the page's Drops/Rewards section(s), same as `extractDropLines`
 * — `{{RareDropTable}}` etc. always appear there (a `Rare drop table` /
 * `Gem drop table` / `Rare and Gem drop table` sub-heading, sibling to
 * `Tertiary`/`Pre-roll`), never elsewhere on the page.
 */
export function extractRdtAccessLines(wikitext: string): RdtAccessResult {
  const sections = findDropsSections(wikitext)
  const lines: RdtAccessLine[] = []
  const unresolved: UnresolvedRdtAccess[] = []

  for (const section of sections) {
    const calls = findTemplateCalls(section.content, RDT_ACCESS_TEMPLATES)
    for (const call of calls) {
      const { name, params } = parseTemplateCall(call)

      if (name.toLowerCase() === 'gwdrdt') {
        unresolved.push({
          reason:
            "references the God Wars Dungeon-variant rare/gem drop table (Template:GWDRDT), a distinct " +
            'table (different composition, no ring-of-wealth effect) from data/tables/rare_drop_table.json ' +
            'and data/tables/gem_drop_table.json — not modelled',
          raw: call,
        })
        continue
      }

      const isRare = name.toLowerCase() === 'raredroptable'
      const primaryRef = isRare ? 'rare_drop_table' : 'gem_drop_table'
      const primaryRate = params.get('1')
      if (primaryRate === undefined) {
        unresolved.push({ reason: `${name} call has no positional access rate`, raw: call })
        continue
      }
      const primary = accessLineFor(primaryRef, primaryRate, params, call)
      if ('reason' in primary) unresolved.push(primary)
      else lines.push(primary)

      // RareDropTable's optional param 2: a separate, independent direct
      // gem-table access rate (only meaningful on the RDT template).
      if (isRare) {
        const secondaryRate = params.get('2')
        if (secondaryRate !== undefined) {
          const secondary = accessLineFor('gem_drop_table', secondaryRate, params, call)
          if ('reason' in secondary) unresolved.push(secondary)
          else lines.push(secondary)
        }
      }
    }
  }

  return { lines, unresolved }
}
