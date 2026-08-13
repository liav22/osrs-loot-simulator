import { DROP_JSON_FIELDS, VARIANT_MARKERS } from '../wiki/fields.js'

/**
 * Extracts `{{DropsLine}}` / `{{DropsLineClue}}` template calls from raw
 * wikitext, grouped by the `===Heading===` they appear under.
 *
 * This reads wikitext rather than the `dropsline` bucket because wikitext is
 * the only place that carries three things the bucket drops on the floor:
 * the heading text itself (needed for PROJECT_PLAN.md 6.5 heuristic 3),
 * quantity qualifiers like "(noted)" (the Brutus resources-table bug), and
 * unambiguous template parameter names instead of a rendered, HTML-bearing
 * `drop_json` blob.
 */

export interface WikitextDropLine {
  heading: string
  /**
   * The enclosing top-level Drops/Rewards heading's own title (e.g. "Elite
   * drops"). Empty when the page has exactly one such section — the common
   * case — so `heading` alone still identifies a sub-table exactly as before;
   * only a page with more than one top-level section needs this to tell two
   * identically-named sub-headings apart (The Mimic's two `===Tertiary===`
   * blocks, one per tier; Scurrius' four sub-headings duplicated across
   * MVP/non-MVP).
   */
  section: string
  name: string
  quantity: string
  rarity: string
  members: boolean
  freeToPlay: boolean
  noted: boolean
  gemwNo: boolean
  /** Raw `namenotes` text, kept for anything the flags miss. */
  nameNotes: string
  /**
   * Raw `raritynotes` text (citations, footnotes, mechanic prose). Used to
   * confirm an ambiguous heading's mode from wiki text rather than guessing
   * — see `build-tables.ts`'s `findConfirmingSignal`.
   */
  rarityNotes: string
  isClue: boolean
}

/**
 * Split a `{{Template|k=v|positional|...}}` call into its name and params.
 * A param with no `=` is positional and keyed by its 1-based index as a
 * string (`"1"`, `"2"`, ...), matching MediaWiki's own numbering — needed for
 * templates like `{{Brimstone rarity|784}}`, whose only argument is
 * positional.
 */
export function parseTemplateCall(call: string): { name: string; params: Map<string, string> } {
  const inner = call.slice(2, -2)
  const parts = splitTopLevelPipes(inner)
  const name = (parts[0] ?? '').trim()
  const params = new Map<string, string>()
  let positional = 1
  for (const part of parts.slice(1)) {
    const eq = part.indexOf('=')
    if (eq === -1) {
      params.set(String(positional), part.trim())
      positional++
      continue
    }
    params.set(part.slice(0, eq).trim(), part.slice(eq + 1).trim())
  }
  return { name, params }
}

/** Splits on `|` at brace/bracket depth 0, so nested templates survive intact. */
function splitTopLevelPipes(text: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < text.length; i++) {
    const two = text.slice(i, i + 2)
    if (two === '{{' || two === '[[') depth++
    else if (two === '}}' || two === ']]') depth--
    else if (text[i] === '|' && depth === 0) {
      parts.push(text.slice(start, i))
      start = i + 1
    }
  }
  parts.push(text.slice(start))
  return parts
}

/** Finds every balanced `{{...}}` template call starting at or after `from`. */
export function findTemplateCalls(text: string, templateNames: readonly string[]): string[] {
  const calls: string[] = []
  const pattern = new RegExp(`\\{\\{(?:${templateNames.join('|')})\\s*[|}]`, 'gi')
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) !== null) {
    const start = match.index
    let depth = 0
    let i = start
    for (; i < text.length; i++) {
      const two = text.slice(i, i + 2)
      if (two === '{{') {
        depth++
        i++
      } else if (two === '}}') {
        depth--
        i++
        if (depth === 0) break
      }
    }
    calls.push(text.slice(start, i + 1))
    pattern.lastIndex = i + 1
  }
  return calls
}

function hasMarker(text: string, marker: RegExp): boolean {
  return marker.test(text)
}

/** True when `gemw=no` is present in the raw params text of a DropsLine call. */
function isGemwNo(call: string): boolean {
  return /\|\s*gemw\s*=\s*no\b/i.test(call)
}

/** A heading of any level (`==`, `===`, `====`, ...), with its own depth. */
interface Heading {
  title: string
  level: number
  start: number
  contentStart: number
}

const HEADING_PATTERN = /\n(={2,6})([^=\n]+)\1[ \t]*\n/g

function findHeadings(text: string): Heading[] {
  const headings: Heading[] = []
  let match: RegExpExecArray | null
  const pattern = new RegExp(HEADING_PATTERN)
  while ((match = pattern.exec(text)) !== null) {
    headings.push({
      title: (match[2] ?? '').trim(),
      level: (match[1] ?? '').length,
      start: match.index,
      contentStart: match.index + match[0].length,
    })
  }
  return headings
}

/**
 * Matches a heading whose SUBJECT is Drops/Rewards — "Drops", "Drops (MVP)",
 * "Rewards", "Elite drops", "Master drops" (The Mimic splits its two reward
 * tiers this way) — not merely a heading that mentions the word, which would
 * also catch an unrelated sibling like Barrows' own "Reward mechanics" (rolls
 * math and citations, no `{{DropsLine}}` calls at all) or Revenant
 * maledictus' "Drop mechanics" (prose, no table). The qualifier is allowed on
 * either side (one word before, or a parenthetical after) but "drops"/
 * "rewards" itself must be the heading's last significant word — that is
 * exactly the distinction between "Elite drops" and "Reward mechanics".
 */
const DROPS_SECTION_TITLE = /^(?:\S+\s+)?(drops?|rewards?)\s*(\(.*\))?$/i

export interface DropsSection {
  /** The section's own top-level heading title, e.g. "Drops" or "Elite drops". */
  title: string
  content: string
}

/**
 * Every "Drops"/"Rewards" section, kept SEPARATE (not concatenated). A page
 * can name it differently (Barrows' chest page uses `==Rewards==`, not
 * `==Drops==`) or use a heading level other than H2 (Gemstone Crab's is
 * `===Drops===`), and can have more than one section (Scurrius splits
 * `==Drops (MVP/Solo)==` from `==Drops (non-MVP)==`; The Mimic splits
 * `==Elite drops==` from `==Master drops==`). A matched section runs until
 * the next heading at its OWN level or shallower — a deeper heading (its own
 * subsections) stays inside it. Keeping sections separate, rather than
 * joining them into one string, is what lets `extractDropLines` tell two
 * identically-named sub-headings in different sections apart instead of
 * silently merging them (The Mimic's two `===Tertiary===` blocks).
 *
 * Only NON-NESTED matches count as a section boundary: a heading already
 * inside a previously-matched section's range is skipped even if its own
 * title also matches `DROPS_SECTION_TITLE`. Several real pages nest a
 * sub-heading that happens to be named "...drops"/"...rewards" too — Branda
 * the Fire Queen's `===Tertiary drops===` inside `==Drops==`, The Mimic's
 * `===Main drops===` inside `==Elite drops==`/`==Master drops==`. Without
 * this guard each of those gets independently re-matched as if it were its
 * own top-level section, spuriously duplicating its rows into a second,
 * heading-less section (surfaced as a `heading: ""` group with no keyword to
 * classify by).
 */
export function findDropsSections(wikitext: string): DropsSection[] {
  const headings = findHeadings(wikitext)
  const sections: DropsSection[] = []
  let claimedUntil = -1

  for (let i = 0; i < headings.length; i++) {
    const heading = headings[i]
    if (heading === undefined) continue
    if (heading.start < claimedUntil) continue
    if (!DROPS_SECTION_TITLE.test(heading.title)) continue
    let end = wikitext.length
    for (let j = i + 1; j < headings.length; j++) {
      const next = headings[j]
      if (next !== undefined && next.level <= heading.level) {
        end = next.start
        break
      }
    }
    // contentStart is right after the heading's own trailing "\n", which
    // HEADING_PATTERN consumed. If a sub-heading immediately follows with no
    // blank line (no prose or templates in between), slicing from
    // contentStart would strip that "\n" and leave the sub-heading with no
    // leading newline of its own to match against — so one character short
    // of contentStart is kept, re-supplying it.
    sections.push({ title: heading.title, content: wikitext.slice(heading.contentStart - 1, end) })
    claimedUntil = end
  }
  return sections
}

/**
 * Groups one drops section by its finest heading level. Nesting deeper than
 * that (Barrows' per-brother `====` groups inside `===Pre-roll===`) collapses
 * into its nearest ancestor group rather than being tracked separately — the
 * cosmetic sub-grouping is lost the same way Brutus' five `/81` headings
 * already collapse into one table; only the shared-denominator/heading-text
 * mode inference in `build-tables.ts` matters structurally.
 *
 * `sectionTag` is stamped onto every line's `section` field, or left `''`
 * when the caller determined this page has only one top-level Drops section
 * (the common case) — see `extractDropLines`.
 */
function extractLinesFromSection(content: string, sectionTag: string): WikitextDropLine[] {
  const headings = findHeadings(content)
  const minLevel = headings.reduce((min, h) => Math.min(min, h.level), Infinity)

  // Only group at the section's shallowest heading level. A deeper heading
  // (Barrows' per-brother `====` groups inside `===Pre-roll===`) is not a new
  // boundary; its content stays attributed to the last-seen shallow heading.
  const boundaries: { heading: string; start: number }[] = headings
    .filter((heading) => heading.level === minLevel)
    .map((heading) => ({ heading: heading.title, start: heading.contentStart }))
  // Content before the first sub-heading belongs to the section's own name,
  // e.g. a lone "100%" block with no sub-heading at all.
  boundaries.unshift({ heading: '', start: 0 })

  const lines: WikitextDropLine[] = []
  for (let i = 0; i < boundaries.length; i++) {
    const boundary = boundaries[i]
    if (boundary === undefined) continue
    const end = boundaries[i + 1]?.start ?? content.length
    const block = content.slice(boundary.start, end)
    // DropsLineReward is Barrows' reward-chest variant of DropsLine — same
    // param shape (name/quantity/rarity/rolls/raritynotes), different name.
    const calls = findTemplateCalls(block, ['DropsLine', 'DropsLineClue', 'DropsLineReward'])

    for (const call of calls) {
      const { name: templateName, params } = parseTemplateCall(call)
      const isClue = templateName.toLowerCase() === 'dropslineclue'
      const nameNotes = params.get('namenotes') ?? ''
      const rarityNotes = params.get('raritynotes') ?? ''
      const markerSource = `${nameNotes} ${rarityNotes} ${call}`

      const itemName = isClue
        ? `Clue scroll (${params.get('type') ?? '?'})`
        : (params.get('name') ?? '')
      if (itemName === '') continue

      lines.push({
        heading: boundary.heading,
        section: sectionTag,
        name: itemName,
        quantity: params.get('quantity') ?? '1',
        rarity: params.get('rarity') ?? '',
        // `f2p=yes` on DropsLineClue is deliberately NOT treated as a
        // membership marker: Brutus' own easy-clue row sets it, yet the
        // rendered page (and the dropsline bucket) marks that exact row
        // "Members-only" via namenotes. Whatever f2p= controls, it is not
        // reliably this drop's membership restriction — see docs/DECISIONS.md.
        members: hasMarker(markerSource, VARIANT_MARKERS.members),
        freeToPlay: hasMarker(markerSource, VARIANT_MARKERS.freeToPlay),
        noted: /\(noted\)/i.test(params.get('quantity') ?? ''),
        gemwNo: isGemwNo(call),
        nameNotes,
        rarityNotes,
        isClue,
      })
    }
  }

  return lines
}

/**
 * Extracts every `{{DropsLine}}`/`{{DropsLineClue}}`/`{{DropsLineReward}}`
 * row from a page's Drops/Rewards section(s). A page with exactly one such
 * section (the overwhelming common case) behaves exactly as before: lines
 * carry `section: ''`, and `heading` alone identifies a sub-table. A page
 * with MORE than one top-level section (The Mimic's Elite/Master split,
 * Scurrius' MVP/non-MVP split) stamps each line's `section` with its own
 * section's title, so `groupByHeading` in `build-tables.ts` can key on
 * `(section, heading)` instead of `heading` alone — without this, two
 * sections' identically-named sub-headings (both have `===Tertiary===`)
 * would merge into one table, mixing rates that were never meant to share a
 * denominator or mode.
 */
export function extractDropLines(wikitext: string): WikitextDropLine[] {
  const sections = findDropsSections(wikitext)
  if (sections.length === 0) return []
  const qualify = sections.length > 1
  return sections.flatMap((section) => extractLinesFromSection(section.content, qualify ? section.title : ''))
}

export { DROP_JSON_FIELDS }
