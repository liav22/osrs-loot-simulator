import { DROP_JSON_FIELDS, VARIANT_MARKERS } from '../wiki/fields.js'
import { PROVENANCE_ACCESS, PROVENANCE_TEMPLATE } from './expand-transclusions.js'

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
  /**
   * The transclusion this row was expanded out of, normalised, or `''` for a
   * row written directly on the page. Set by `expand-transclusions.ts`.
   *
   * A block whose rows ALL carry the same value is one sub-table as the wiki
   * itself packages it, which is what `build-tables.ts` needs to decide the
   * block's mode instead of guessing from denominators.
   */
  expandedFrom: string
  /**
   * That transclusion's declared access rate, verbatim (`5/139`), or `''` when
   * it declares none. The rows of a real sub-table sum to exactly this — see
   * `transclusionPartition`.
   */
  accessRate: string
  /**
   * `{{DropsTableHead|dropversion=X}}`'s `dropversion` value, verbatim
   * (`"Normal Mode"`, not normalised to lowercase — matching the convention
   * `rdt-access.ts` already established for the exact same parameter on
   * `{{RareDropTable}}`/`{{GemDropTable}}` access lines), or `null` when this
   * row sits under no such heading.
   *
   * Regular drop rows never had this before: a `dropversion`-scoped
   * `{{DropsTableHead}}` was read for RDT access lines but not for ordinary
   * `{{DropsLine}}`/`{{DropsLineReward}}` rows, so a page whose Normal/Hard
   * Mode variants sit under nested sub-headings (Monumental chest's
   * `====Normal mode====`/`====Hard mode====` inside `===Pre-roll===`) had
   * both modes' rows collapse into one table with no variant tag at all —
   * `splitIntoBlocks`' "nesting deeper than the section's shallowest level
   * collapses into its parent group" rule (by design, for Barrows' per-brother
   * sub-groups) means the two modes were never even separate BLOCKS, only
   * separate template scopes within one block. This field closes that gap
   * without touching the blocking/grouping behaviour at all — see
   * `scanBlockCalls`.
   */
  variant: string | null
  /**
   * Prose sitting between this row's heading and the first `{{DropsTableHead}}`/
   * row-template call in its block — block-level, not per-row, so every line in
   * the same block carries an identical value. This is what lets
   * `build-tables.ts`'s bundle detection see wiki text like "These supplies are
   * dropped together" that sits ABOVE a table with no per-row footnote at all
   * (Maggot King, Mad Angel) — the shared-footnote signal
   * (`WikitextDropLine.rarityNotes`) cannot see this shape, since there is no
   * footnote to share. See `findBundleGroups` in `build-tables.ts`.
   */
  blockPreamble: string
  /**
   * Set only on a SYNTHETIC line `build-tables.ts`'s `findBundleGroups`
   * creates to stand in for N real rows it has collapsed into one confirmed
   * co-drop bundle — never present on a line `extractDropLines` itself
   * produces. Carries the real per-item wiki data (name/quantity/noted) for
   * each bundled member, so `assembleBoss` can build a `tableRef` node into a
   * synthesized `data/tables/<id>.json` (`mode: 'always'`) instead of
   * resolving `name` as a single item — see docs/DECISIONS.md's "bundle
   * shape, assessed" entry.
   */
  bundle?: {
    heading: string
    members: { name: string; quantity: string; noted: boolean }[]
    signal: string
  }
}

/**
 * Split a `{{Template|k=v|positional|...}}` call into its name and params.
 * A param with no `=` is positional and keyed by its 1-based index as a
 * string (`"1"`, `"2"`, ...), matching MediaWiki's own numbering — needed for
 * templates like `{{Brimstone rarity|784}}`, whose only argument is
 * positional.
 *
 * **Named keys are lowercased.** Yama's `Supplies`/`Runes`/`Other` headings
 * write `Rarity=`/`Quantity=` (capitalised) on some rows and `rarity=`/
 * `quantity=` on others in the same block — a page-authoring inconsistency,
 * not two different parameters: the wiki's own rendered drop bucket still
 * lists every one of those 18 items, so whatever resolves `{{DropsLine}}`
 * server-side treats the casing as equivalent. Every consumer already reads
 * a lowercase literal (`params.get('rarity')` etc.), so this is a pure
 * recovery, not a behavioural change for the already-lowercase common case.
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
    params.set(part.slice(0, eq).trim().toLowerCase(), part.slice(eq + 1).trim())
  }
  return { name, params }
}

/**
 * Splits on `|` at brace/bracket depth 0, so nested templates survive intact.
 *
 * **A matched 2-character token consumes BOTH its characters (`i += 2` via
 * the extra `i++` below, on top of the loop's own increment), not one.**
 * Without it, a run of 3+ identical bracket characters produces overlapping
 * matches instead of the true count of pairs: `}}}}` (two templates closing
 * back-to-back, e.g. `{{Refn|...{{CiteDiscord|...}}}}`) is two real closes,
 * but scanning one character at a time finds THREE overlapping `}}` windows
 * (`text.slice(0,2)`, `text.slice(1,3)`, `text.slice(2,4)` all equal `"}}"`),
 * decrementing depth three times instead of two and leaving it permanently
 * one level shallow for everything after. On a real page this corrupted an
 * item's own `name` param: Bryophyta's `{{DropsLine|name=Mossy key|...
 * |raritynotes={{Refn|...{{CiteDiscord|...}}}}{{CiteNews|...|name=keyrate}}}}`
 * has exactly this `}}}}` seam where Refn's nested citation and the sibling
 * CiteNews both close at once — the desync made `|name=keyrate` (a citation's
 * OWN name param, nested two templates deep) read as depth 0, i.e. a
 * TOP-LEVEL param of the outer `DropsLine` call, silently overwriting `name=
 * Mossy key` with `keyrate}}` and shipping a fabricated item into the corpus.
 *
 * `findTemplateCalls` below never had this bug — its depth loop already does
 * an equivalent extra `i++` on a match — which is why it correctly found the
 * true 968-character extent of that same `DropsLine` call while THIS function
 * mis-split its params. Verified as a pure fix, not a behavioural change: run
 * against every `{{DropsLine}}`-family call recovered from all 209 wikitext
 * snapshots (post-transclusion-expansion), parsed params are byte-identical
 * before and after except on the two pages that actually carry this pattern
 * (Bryophyta and Obor, which share the cited news post verbatim).
 */
function splitTopLevelPipes(text: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < text.length; i++) {
    const two = text.slice(i, i + 2)
    if (two === '{{' || two === '[[') {
      depth++
      i++
    } else if (two === '}}' || two === ']]') {
      depth--
      i++
    } else if (text[i] === '|' && depth === 0) {
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

/**
 * The title group is LAZY (`.+?`), not `[^=\n]+`. A heading whose title
 * contains an inline HTML attribute — Reward Chest (The Gauntlet)'s
 * `==Junk table<span id="Failure"/>==` — has an `=` INSIDE the title itself
 * (`id="Failure"`), and `[^=\n]+` cannot span it: it stops at the first `=`,
 * leaving nothing that reads as `\1` (a literal `==`) immediately after, so
 * the whole heading was invisible to `findHeadings` — not a `DROPS_SECTION_TITLE`
 * problem, a heading-detection one. The lazy form crawls forward until it
 * finds the real closing `={2,6}` immediately followed by only whitespace and
 * a newline, which correctly skips the single `=` inside the tag and lands on
 * the genuine delimiter.
 *
 * Verified as a pure recovery, not a behavioural change: run against all 209
 * wikitext snapshots, this produces byte-identical heading lists on every
 * page except `reward-chest-the-gauntlet`, where it recovers exactly its four
 * previously-invisible top-level headings.
 */
const HEADING_PATTERN = /\n(={2,6})(.+?)\1[ \t]*\n/g

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
 *
 * Trusted UNCONDITIONALLY, with no check on the section's own content —
 * `findRowlessTemplateBlocks` depends on that: it exists specifically to
 * report a section this rule correctly identifies as a drops area that
 * currently yields zero rows (an unexpandable transclusion). Content-gating
 * this rule would make that diagnostic blind on exactly the pages it exists
 * for. See `LOOSE_DROPS_SECTION_TITLE` below for the rule that DOES need one.
 */
const DROPS_SECTION_TITLE = /^(?:\S+\s+)?(drops?|rewards?)\s*(\(.*\))?$/i

/**
 * A looser match for headings the tight rule's one-word cap cannot see, plus
 * "table" as an alternative to "drops"/"rewards" — two real corpus shapes:
 *
 *  - **An unlimited word count before "drops"/"rewards".** Obor/Bryophyta's
 *    `==Members' worlds drops==` / `==Free-to-play worlds drops==` (2-word
 *    prefix, a section-level members/F2P split rather than per-row markers);
 *    Black demon's `==Level 172, 178, and 184 drops==` (5 words) and
 *    `==Wilderness Slayer Cave drops==` (3 words).
 *  - **"...table" instead of "...drops"/"...rewards".** Reward Chest (The
 *    Gauntlet)'s `Junk table` / `Incomplete loot table` / `Regular loot
 *    table` / `Corrupted loot table` (each also needed `HEADING_PATTERN`'s
 *    fix to be visible as a heading at all, since each carries a trailing
 *    `<span id="...">` anchor `stripInlineTags` removes before either title
 *    regex runs).
 *
 * **Deliberately NOT trusted on its own — content is the tie-breaker, checked
 * at the call site.** `Salarin the Twisted`'s `===Training and Rewards===` (a
 * Magic-training guide subsection, pure prose) matches this exact shape and
 * must still be rejected the same way "Reward mechanics" is. Word count alone
 * cannot separate the two: "Training and Rewards" and "Members' worlds drops"
 * both carry a 2-word prefix, so a wider cap doesn't help, and Black demon's
 * genuine heading needs 5 words, more than "Training and Rewards" ever had.
 * What DOES separate them is content: every genuine loose match in the corpus
 * carries at least one real `DropsLine`/`DropsLineClue`/`DropsLineReward` call
 * in its own section; "Training and Rewards" carries none. So a match here is
 * provisional — `findDropsSections` only keeps it once the computed section
 * content is confirmed to have a row template, which is also why this rule
 * cannot be folded into `DROPS_SECTION_TITLE` and content-gated uniformly:
 * `findRowlessTemplateBlocks` needs the tight rule's sections to survive with
 * zero rows, precisely to report that they have none.
 */
const LOOSE_DROPS_SECTION_TITLE = /^.+?\b(drops?|rewards?|table)\s*(\(.*\))?$/i

/**
 * Strips inline HTML MediaWiki tolerates inside a heading — Reward Chest (The
 * Gauntlet)'s `<span id="Failure"/>`-style anchors — so both title regexes and
 * downstream table-id slugs see clean text instead of wiki markup. Checked
 * against the whole corpus: this page is the only one with a `<` in any
 * heading, so the strip is a no-op everywhere else.
 */
function stripInlineTags(title: string): string {
  return title.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim()
}

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
    const title = stripInlineTags(heading.title)
    const tight = DROPS_SECTION_TITLE.test(title)
    if (!tight && !LOOSE_DROPS_SECTION_TITLE.test(title)) continue

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
    const content = wikitext.slice(heading.contentStart - 1, end)

    // The loose rule's content gate — see LOOSE_DROPS_SECTION_TITLE's comment
    // for why this can't apply to a tight match too.
    if (!tight && findTemplateCalls(content, [...ROW_TEMPLATES]).length === 0) continue

    sections.push({ title, content })
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
function splitIntoBlocks(content: string): { heading: string; block: string }[] {
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

  return boundaries.map((boundary, i) => ({
    heading: boundary.heading,
    block: content.slice(boundary.start, boundaries[i + 1]?.start ?? content.length),
  }))
}

/** The row templates, which carry one drop each. */
const ROW_TEMPLATES = ['DropsLine', 'DropsLineClue', 'DropsLineReward'] as const

/**
 * Every `{{DropsTableHead}}` / row-template call within a block, IN DOCUMENT
 * ORDER with position, so a caller can track "which `{{DropsTableHead
 * |dropversion=}}` most recently preceded this row" — `findTemplateCalls`
 * alone can't answer that, since it returns unordered-relative-to-each-other
 * call strings for one template family at a time, with no position.
 *
 * Deliberately reuses `findTemplateCalls`' own depth-tracking extraction
 * (called once per family, then merged and sorted by `start`) rather than a
 * new scanner — two independently-tested extractions merged is less risk
 * than a third parallel implementation of the same brace-depth logic.
 */
function scanBlockCalls(
  block: string
): { name: string; call: string; start: number }[] {
  const found: { name: string; call: string; start: number }[] = []
  for (const templateName of ['DropsTableHead', ...ROW_TEMPLATES]) {
    // `findTemplateCalls` already returns this family's calls in document
    // order, so walking `indexOf` forward from a moving cursor (rather than
    // `block.indexOf(call)` from the start each time) still finds the right
    // occurrence when the same call string repeats verbatim more than once —
    // two byte-identical `{{DropsLineReward|...}}` rows are not hypothetical
    // in this corpus (e.g. an item appearing at two different rarities under
    // one heading can render identically apart from position).
    let cursor = 0
    for (const call of findTemplateCalls(block, [templateName])) {
      const start = block.indexOf(call, cursor)
      found.push({ name: templateName, call, start })
      cursor = start + call.length
    }
  }
  return found.sort((a, b) => a.start - b.start)
}

function extractLinesFromSection(content: string, sectionTag: string): WikitextDropLine[] {
  const lines: WikitextDropLine[] = []
  for (const { heading, block } of splitIntoBlocks(content)) {
    // Walked in document order so a `{{DropsTableHead|dropversion=X}}` sets
    // the variant in effect for every row template that follows it, until the
    // next `{{DropsTableHead}}` changes it — the same "most recent value
    // wins" reading `rdt-access.ts` already gives this parameter on RDT/gem
    // access lines. `{{DropsTableBottom}}` does not reset it: nothing in the
    // corpus needs "no variant" to interrupt two dropversion-tagged blocks in
    // a row, and treating it as a reset would require reasoning about
    // same-block-no-heading rows that don't occur here.
    let currentVariant: string | null = null

    const calls = scanBlockCalls(block)
    // Everything before the first template call in the block — prose sitting
    // directly under the heading, above `{{DropsTableHead}}`/the first row.
    // Trimmed once here rather than by every caller.
    const blockPreamble = block.slice(0, calls[0]?.start ?? block.length).trim()

    for (const { name: templateName, call } of calls) {
      const { params } = parseTemplateCall(call)

      if (templateName === 'DropsTableHead') {
        currentVariant = params.get('dropversion') ?? currentVariant
        continue
      }

      const isClue = templateName.toLowerCase() === 'dropslineclue'
      const nameNotes = params.get('namenotes') ?? ''
      const rarityNotes = params.get('raritynotes') ?? ''
      const markerSource = `${nameNotes} ${rarityNotes} ${call}`

      const itemName = isClue
        ? `Clue scroll (${params.get('type') ?? '?'})`
        : (params.get('name') ?? '')
      if (itemName === '') continue

      lines.push({
        heading,
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
        expandedFrom: params.get(PROVENANCE_TEMPLATE) ?? '',
        accessRate: params.get(PROVENANCE_ACCESS) ?? '',
        variant: currentVariant,
        blockPreamble,
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

/**
 * Templates that legitimately appear in a drop sub-table that has no rows of
 * its own, and so must not be reported as a lost sub-table.
 *
 * Deliberately three names, all structural: the wikitable scaffolding a
 * transcluded sub-table leaves behind, and the shared-table access calls
 * `rdt-access.ts` turns into a `tableRef` (it reports its OWN unresolved
 * cases, `{{GWDRDT}}` among them — see HANDOFF landmine #3). Every other
 * template in a rowless block is a candidate for the silent-vanish bug, and
 * this list must not grow to quiet a report: a check that stops looking is
 * the exact failure mode `drops_covered` exists to end.
 */
const NON_ROW_TEMPLATES = /^(DropsTableHead|DropsTableBottom|RareDropTable|GemDropTable|GWDRDT)\b/i

/** Any `{{Name` at the start of a line — a transcluded body, not inline prose markup. */
const BLOCK_TEMPLATE = /^\{\{([^|}\n]+)/gm

export interface RowlessTemplateBlock {
  section: string
  heading: string
  /** The template names left standing in a block that produced no drop rows. */
  templates: string[]
}

/**
 * Drop sub-sections whose body is a template call yet yield no rows.
 *
 * This is the silent-vanish signature itself: `extractDropLines` reads
 * `{{DropsLine}}` calls, so `===Sigils===\n{{Uniques/Corporeal Beast}}`
 * produces an empty section, and an empty section is indistinguishable from an
 * absent one to everything downstream. Corporeal Beast shipped `verified` with
 * all three sigils missing this way.
 *
 * Run against EXPANDED wikitext (see `expand-transclusions.ts`), this reports
 * only what expansion could not reach — a template with no definition on disk,
 * or one whose body is a Lua module. It is a warning rather than a gate:
 * `drops_covered` is the check that decides whether the document is complete,
 * and it answers the same question against the wiki's own drop rows instead of
 * against the shape of the wikitext.
 */
export function findRowlessTemplateBlocks(wikitext: string): RowlessTemplateBlock[] {
  const sections = findDropsSections(wikitext)
  const qualify = sections.length > 1
  const rowless: RowlessTemplateBlock[] = []

  for (const section of sections) {
    for (const { heading, block } of splitIntoBlocks(section.content)) {
      if (findTemplateCalls(block, [...ROW_TEMPLATES]).length > 0) continue
      const templates = [...block.matchAll(BLOCK_TEMPLATE)]
        .map((match) => (match[1] ?? '').trim())
        .filter((name) => name !== '' && !NON_ROW_TEMPLATES.test(name))
      if (templates.length === 0) continue
      rowless.push({ section: qualify ? section.title : '', heading, templates })
    }
  }
  return rowless
}

export { DROP_JSON_FIELDS }
