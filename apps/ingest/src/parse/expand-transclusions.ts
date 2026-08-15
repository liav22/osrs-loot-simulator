import { listSnapshots, readSnapshot } from '../snapshots/store.js'

/**
 * Expands template transclusions in page wikitext, so that a drop sub-table
 * written as `{{TalismanDropLines|1/128}}` becomes the `{{DropsLine}}` calls
 * `extractDropLines` already knows how to read.
 *
 * ## The gap this closes
 *
 * `extractDropLines` reads `{{DropsLine}}` calls out of raw wikitext. A section
 * whose body is a transclusion has none:
 *
 * ```
 * ===Sigils===
 * {{Uniques/Corporeal Beast}}
 * ```
 *
 * so it yields zero rows and disappears — and an empty section is
 * indistinguishable from an absent one to everything downstream. That cost the
 * corpus 427 drop rows across 28 sources (every seed on Vorkath and the
 * Dagannoths, the herb and talisman sub-tables, Larran's key, Corp's three
 * sigils), all of it invisible until `drops_covered` shipped. See
 * docs/DECISIONS.md.
 *
 * ## Why expansion happens HERE and not through the wiki's own API
 *
 * `action=expandtemplates` is the obvious candidate and is the wrong tool: it
 * expands *recursively, all the way down*, so `{{DropsLine|name=Air talisman
 * |rarity=1/700}}` comes back as the rendered wikitable row it produces. That
 * throws away exactly the three things Phase 3 chose wikitext for in the first
 * place (see `wikitext-drops.ts`) — unambiguous parameter names, `(noted)`
 * qualifiers, and the heading structure — to solve a problem that only needs
 * ONE level of expansion. Expanding locally keeps the `{{DropsLine}}` calls
 * intact and costs no requests per source.
 *
 * What it does cost is a definition per template, fetched once into
 * `data/snapshots/wikitext/template-*.json` and re-read offline forever after.
 * **The set of definitions on disk is the whole scope of this module**: a
 * template with no snapshot is left exactly as it was found. Teaching the
 * parser a new drop-table template is therefore one fetch and no code — which
 * is the point, and the reason this is not a registry of per-template
 * handlers.
 *
 * ## What is deliberately NOT expanded
 *
 * Anything already modelled as a `tableRef` — see `TABLEREF_TEMPLATES`.
 * Inlining a shared table's rows into each of its seventeen referencing bosses
 * would undo Phase 3.
 *
 * ## Fidelity
 *
 * These templates compute their rendered rarities from the access rate the
 * page passes in (`{{#vardefine:talbase|{{#expr:{{{1}}}/70}}}}`), so the
 * expansion has to evaluate MediaWiki's own parser functions to reproduce the
 * numbers the wiki publishes. It does, and the `dropsline` bucket snapshot is
 * an independent check that it got them right: Vorkath's expanded Ranarr seed
 * lands on `1/416.7`, which is the figure the bucket already carried.
 */

/**
 * Templates whose CALL survives expansion, with only their arguments expanded.
 * These are the leaves — the rows themselves — and re-emitting them verbatim
 * is what lets `extractDropLines` read parameter names off an expanded page
 * exactly as it does off a hand-written one.
 *
 * `DropsLineSkill` is `UncommonSeedDropLines`' conditional variant: it builds
 * its own template name as `DropsLine{{#var:skill}}`, which resolves to
 * `DropsLine` unless the page passed `skill=`.
 */
const TERMINAL_TEMPLATES = new Set([
  'dropsline',
  'dropslineclue',
  'dropslinereward',
  'dropslineskill',
])

/**
 * Templates that are NOT inlined because another parse stage already models
 * them, as a `tableRef` to a shared `data/tables/*.json` record.
 * `rdt-access.ts` owns these three: it reads the access RATE off the call and
 * emits a ref, precisely so the rare/gem/GWD tables live in one record instead
 * of being copied into every boss that reaches them.
 *
 * Their definitions are on disk (an earlier session fetched them to confirm
 * parameter semantics), so without this they would be inlined on sight — which
 * would both undo Phase 3 and break `rdt-access.ts`, whose extraction runs
 * against the same wikitext and looks for these calls by name.
 */
const TABLEREF_TEMPLATES = new Set(['raredroptable', 'gemdroptable', 'gwdrdt'])

/**
 * Synthetic `{{DropsLine}}` parameters the expander stamps onto every row it
 * produces, recording which transclusion emitted it and that transclusion's
 * declared access rate.
 *
 * They are parser-internal and never reach a generated document: the extractor
 * reads them into `WikitextDropLine` and nothing downstream copies them into a
 * `Boss`. The `__` prefix marks them as not-from-the-wiki — no real DropsLine
 * parameter starts with one.
 */
export const PROVENANCE_TEMPLATE = '__expandedfrom'
export const PROVENANCE_ACCESS = '__accessrate'

/** MediaWiki template naming: underscores are spaces, first letter case-insensitive. */
function normalizeTemplateName(name: string): string {
  return name.trim().replace(/_/g, ' ').replace(/\s+/g, ' ').toLowerCase()
}

export type TemplateDefinitions = ReadonlyMap<string, string>

export interface ExpansionResult {
  wikitext: string
  /** Normalised names of every template actually inlined, in first-seen order. */
  expanded: string[]
  /**
   * Transclusions that could not be expanded and why. A template whose body
   * delegates to a Lua module (`{{#invoke:}}`) is the real case: the module's
   * source is not wikitext and this expander cannot run it, so the rows stay
   * missing. Reported rather than swallowed — a transclusion that silently
   * yields nothing is the exact bug this module exists to end.
   */
  unexpandable: { template: string; reason: string }[]
}

interface Context {
  /** The enclosing call's arguments; empty at page level. */
  args: ReadonlyMap<string, string>
  defs: TemplateDefinitions
  /**
   * Extension:Variables state. Page-scoped and order-dependent, exactly as on
   * the wiki: `{{#vardefine:}}` writes and a later `{{#var:}}` reads, so this
   * is shared across every template on the page rather than per call.
   */
  vars: Map<string, string>
  expanded: string[]
  unexpandable: { template: string; reason: string }[]
  depth: number
  /**
   * How many times a `{{{arg}}}` with no default resolved to nothing, because
   * the calling page never supplied it. Used to tell a template branch that is
   * simply NOT IN USE from a genuine gap in this expander — see the `catch` in
   * `expand`.
   */
  missingArgs: number
  /**
   * The transclusion currently being expanded, or null at page level. Set when
   * descending into a template body so the rows it emits can be stamped with
   * where they came from.
   */
  transclusion: { template: string; accessRate: string } | null
}

const MAX_DEPTH = 20

/**
 * Finds the index just past the `{{...}}` / `{{{...}}}` construct starting at
 * `start`, or -1 if it is unbalanced.
 *
 * Brace runs are ambiguous (`{{{a|{{b}}}}}` ends in five closing braces), so
 * the scanner records which kind of opener it pushed and closes a triple only
 * against a triple. Doing it by counting braces alone gets `{{{1}}}` wrong —
 * it reads as `{{` + `{1}` + `}}`.
 */
function findConstructEnd(text: string, start: number): number {
  const stack: (2 | 3)[] = []
  let i = start
  while (i < text.length) {
    if (text.startsWith('{{{', i)) {
      stack.push(3)
      i += 3
    } else if (text.startsWith('{{', i)) {
      stack.push(2)
      i += 2
    } else if (text.startsWith('}}}', i) && stack[stack.length - 1] === 3) {
      stack.pop()
      i += 3
      if (stack.length === 0) return i
    } else if (text.startsWith('}}', i)) {
      stack.pop()
      i += 2
      if (stack.length === 0) return i
    } else {
      i++
    }
  }
  return -1
}

/** Splits on `|` at construct depth 0, so nested calls survive intact. */
function splitArgs(text: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < text.length; i++) {
    if (text.startsWith('{{', i) || text.startsWith('[[', i)) {
      depth++
      i++
    } else if (text.startsWith('}}', i) || text.startsWith(']]', i)) {
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

/**
 * Strips a template definition down to what a transclusion of it actually
 * sees: `<onlyinclude>` wins outright if present, `<noinclude>` blocks are
 * dropped, `<includeonly>` markers are unwrapped, and HTML comments go.
 */
export function transclusionBody(definition: string): string {
  const onlyInclude = [...definition.matchAll(/<onlyinclude>([\s\S]*?)<\/onlyinclude>/gi)]
  const base =
    onlyInclude.length > 0
      ? onlyInclude.map((m) => m[1] ?? '').join('')
      : definition.replace(/<noinclude>[\s\S]*?<\/noinclude>/gi, '')
  return base
    .replace(/<\/?includeonly>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .trim()
}

/**
 * MediaWiki `{{#expr:}}`, enough of it to evaluate what the drop-table
 * templates use: arithmetic, parentheses, and the `round` operator that
 * produces the published one-decimal rarities (`1/416.7`).
 *
 * Anything it does not recognise throws, and the caller turns that into a
 * reported failure — never a silent zero, the same discipline `stubFormula`
 * follows in the loot model.
 */
export function evaluateExpr(input: string): number {
  const tokens = input
    .toLowerCase()
    .match(/\d+(?:\.\d+)?(?:e[+-]?\d+)?|<=|>=|<>|!=|[+\-*/()^<>=]|[a-z]+/g)
  if (tokens === null) throw new Error(`empty #expr: '${input}'`)

  let pos = 0
  const peek = (): string | undefined => tokens[pos]
  const eat = (): string => tokens[pos++] ?? ''

  // Precedence, loosest first, matching ParserFunctions:
  //   or < and < comparison < round < +- < */ < ^ < unary < primary.
  //
  // The comparison operators are not decoration: `WildernessSlayerDropTable`
  // selects its key denominator with `{{#switch: 1 | {{#expr: {{{combat}}} <
  // 81 }} = ... }}`, so an evaluator that cannot compare does not merely fail
  // — the switch falls through to its literal `| 1 = 50` case and publishes a
  // plausible, wrong 1/50 for every source. That shipped once, briefly, and is
  // why `unexpandable` now blocks `verified` as well.
  const parseOr = (): number => {
    let left = parseAnd()
    while (peek() === 'or') {
      eat()
      const right = parseAnd()
      left = left !== 0 || right !== 0 ? 1 : 0
    }
    return left
  }

  const parseAnd = (): number => {
    let left = parseComparison()
    while (peek() === 'and') {
      eat()
      const right = parseComparison()
      left = left !== 0 && right !== 0 ? 1 : 0
    }
    return left
  }

  const parseComparison = (): number => {
    let left = parseRound()
    for (;;) {
      const op = peek()
      if (op !== '<' && op !== '>' && op !== '<=' && op !== '>=' && op !== '=' && op !== '!=' && op !== '<>') {
        return left
      }
      eat()
      const right = parseRound()
      const value =
        op === '<' ? left < right
        : op === '>' ? left > right
        : op === '<=' ? left <= right
        : op === '>=' ? left >= right
        : op === '=' ? left === right
        : left !== right
      left = value ? 1 : 0
    }
  }

  const parseRound = (): number => {
    let left = parseAdditive()
    while (peek() === 'round') {
      eat()
      const digits = parseAdditive()
      const factor = 10 ** Math.trunc(digits)
      // MediaWiki rounds half away from zero, not JS's half-up-toward-+inf.
      left = Math.sign(left) * (Math.round(Math.abs(left) * factor) / factor)
    }
    return left
  }

  const parseAdditive = (): number => {
    let left = parseMultiplicative()
    for (;;) {
      const op = peek()
      if (op !== '+' && op !== '-') return left
      eat()
      const right = parseMultiplicative()
      left = op === '+' ? left + right : left - right
    }
  }

  const parseMultiplicative = (): number => {
    let left = parsePower()
    for (;;) {
      const op = peek()
      if (op !== '*' && op !== '/' && op !== 'div' && op !== 'mod') return left
      eat()
      const right = parsePower()
      if (op === '*') left = left * right
      else if (op === 'mod') left = left % right
      else {
        if (right === 0) throw new Error(`division by zero in #expr: '${input}'`)
        left = left / right
      }
    }
  }

  const parsePower = (): number => {
    let left = parseUnary()
    while (peek() === '^') {
      eat()
      left = left ** parseUnary()
    }
    return left
  }

  const parseUnary = (): number => {
    const token = peek()
    if (token === '-') {
      eat()
      return -parseUnary()
    }
    if (token === '+') {
      eat()
      return parseUnary()
    }
    if (token === 'not') {
      eat()
      return parseUnary() === 0 ? 1 : 0
    }
    if (token === 'floor') {
      eat()
      return Math.floor(parseUnary())
    }
    if (token === 'ceil') {
      eat()
      return Math.ceil(parseUnary())
    }
    if (token === 'trunc') {
      eat()
      return Math.trunc(parseUnary())
    }
    if (token === 'abs') {
      eat()
      return Math.abs(parseUnary())
    }
    return parsePrimary()
  }

  const parsePrimary = (): number => {
    const token = eat()
    if (token === '(') {
      const value = parseOr()
      if (eat() !== ')') throw new Error(`unbalanced parentheses in #expr: '${input}'`)
      return value
    }
    const value = Number(token)
    if (!Number.isFinite(value)) throw new Error(`unsupported token '${token}' in #expr: '${input}'`)
    return value
  }

  const result = parseOr()
  if (pos !== tokens.length) throw new Error(`trailing input in #expr: '${input}'`)
  return result
}

/**
 * `{{{name|default}}}` — an argument of the enclosing call, or its default.
 * An undefined argument with no default expands to the literal `{{{name}}}` on
 * the real wiki; here it becomes empty, because a leftover `{{{...}}}` in a
 * `rarity=` value would only ever be read as an unparseable rarity.
 */
function expandParameter(inner: string, ctx: Context): string {
  const parts = splitArgs(inner)
  const name = expand(parts[0] ?? '', ctx).trim()
  const supplied = ctx.args.get(name)
  if (supplied !== undefined && supplied !== '') return supplied
  if (parts.length > 1) return expand(parts.slice(1).join('|'), ctx)
  if (supplied === undefined) ctx.missingArgs++
  return supplied ?? ''
}

/** A `{{#func: ... }}` parser function, or null when `text` names no function. */
function expandParserFunction(name: string, rest: string, ctx: Context): string | null {
  const args = splitArgs(rest)
  const arg = (i: number): string => expand(args[i] ?? '', ctx).trim()

  switch (name) {
    case '#if':
      return arg(0) !== '' ? arg(1) : arg(2)
    case '#ifeq':
      return arg(0) === arg(1) ? arg(2) : arg(3)
    case '#ifexpr':
      return evaluateExpr(arg(0)) !== 0 ? arg(1) : arg(2)
    case '#switch': {
      const subject = arg(0)
      let fallback = ''
      for (let i = 1; i < args.length; i++) {
        const part = args[i] ?? ''
        const eq = part.indexOf('=')
        if (eq === -1) continue
        const key = expand(part.slice(0, eq), ctx).trim()
        const value = expand(part.slice(eq + 1), ctx).trim()
        if (key === subject) return value
        if (key === '#default') fallback = value
      }
      return fallback
    }
    case '#expr': {
      const value = evaluateExpr(arg(0))
      // Match MediaWiki's own formatting: integers print without a decimal
      // point, and a value like 416.7 must not come back as 416.70000000001.
      return String(Number(value.toPrecision(14)))
    }
    case '#vardefine':
      ctx.vars.set(arg(0), arg(1))
      return ''
    case '#var':
      return ctx.vars.get(arg(0)) ?? (args.length > 1 ? arg(1) : '')
    case '#varexists':
      return ctx.vars.has(arg(0)) ? (args.length > 1 ? arg(1) : '1') : (args.length > 2 ? arg(2) : '')
    default:
      return null
  }
}

/** Expands one `{{...}}` construct's inner text (everything between the braces). */
function expandCall(inner: string, ctx: Context): string {
  const colon = inner.indexOf(':')
  const pipe = inner.indexOf('|')

  // A parser function is `{{#name: ...}}` — the `#` is what distinguishes it
  // from a template whose name merely contains a colon.
  if (inner.trimStart().startsWith('#') && colon !== -1 && (pipe === -1 || colon < pipe)) {
    const name = inner.slice(0, colon).trim().toLowerCase()
    if (name === '#invoke') {
      // A Lua module. Its source is not wikitext, so this expander cannot run
      // it; the call is left in place and reported by the caller.
      return `{{${inner}}}`
    }
    const result = expandParserFunction(name, inner.slice(colon + 1), ctx)
    if (result !== null) return result
    return `{{${inner}}}`
  }

  const parts = splitArgs(inner)
  const rawName = expand(parts[0] ?? '', ctx)
  const name = normalizeTemplateName(rawName)

  // A leaf row: keep the call, expand only its arguments, so the extractor
  // reads real parameter names off a real `{{DropsLine}}`.
  if (TERMINAL_TEMPLATES.has(name)) {
    const expandedArgs = parts.slice(1).map((part) => expand(part, ctx))
    // DropsLineSkill shares DropsLine's parameter shape; renaming it here is
    // what lets `extractDropLines` treat the two identically without knowing
    // that UncommonSeedDropLines builds its own template name.
    const emitted = name === 'dropslineskill' ? 'DropsLine' : rawName.trim()
    // Provenance, stamped onto the row itself. Downstream has to know that a
    // block's rows all came from ONE transclusion, and at what declared access
    // rate, to decide the block's mode — see `build-tables.ts`'s
    // `transclusionPartition`. Threading it as synthetic parameters keeps the
    // pipeline text-in-text-out, rather than adding a side channel that would
    // have to be re-joined to lines after heading grouping.
    const provenance =
      ctx.transclusion === null
        ? []
        : [
            `${PROVENANCE_TEMPLATE}=${ctx.transclusion.template}`,
            `${PROVENANCE_ACCESS}=${ctx.transclusion.accessRate}`,
          ]
    return `{{${[emitted, ...expandedArgs, ...provenance].join('|')}}}`
  }

  if (TABLEREF_TEMPLATES.has(name)) return `{{${inner}}}`

  const definition = ctx.defs.get(name)
  if (definition === undefined) return `{{${inner}}}`

  if (ctx.depth >= MAX_DEPTH) {
    ctx.unexpandable.push({ template: name, reason: `expansion exceeded ${MAX_DEPTH} levels` })
    return `{{${inner}}}`
  }

  const body = transclusionBody(definition)
  if (/\{\{#invoke:/i.test(body)) {
    ctx.unexpandable.push({
      template: name,
      reason: 'its body delegates to a Lua module ({{#invoke:}}), which is not wikitext',
    })
    return `{{${inner}}}`
  }

  const args = new Map<string, string>()
  let positional = 1
  for (const part of parts.slice(1)) {
    const eq = part.indexOf('=')
    if (eq === -1) {
      args.set(String(positional), expand(part, ctx).trim())
      positional++
      continue
    }
    args.set(expand(part.slice(0, eq), ctx).trim(), expand(part.slice(eq + 1), ctx).trim())
  }

  if (!ctx.expanded.includes(name)) ctx.expanded.push(name)
  // The access rate this transclusion declares, as the page wrote it. Every
  // sub-table template takes it as its first positional argument and divides
  // it by the sub-table's own denominator to derive each row's rate
  // (`{{#vardefine:talbase|{{#expr:{{{1}}}/70}}}}`); `FossilDropLines` names it
  // `access`. A template that declares NEITHER — `WildernessSlayerDropTable`,
  // whose two rows are independent rolls derived from different inputs
  // entirely — leaves this empty, and the partition check downstream then has
  // nothing to test and correctly abstains.
  const accessRate = args.get('1') ?? args.get('access') ?? ''
  return expand(body, {
    ...ctx,
    args,
    depth: ctx.depth + 1,
    // An inner transclusion wins, so the rate stamped on a row is always the
    // one belonging to the template that actually emitted it.
    transclusion: { template: name, accessRate },
  })
}

function expand(text: string, ctx: Context): string {
  let out = ''
  let i = 0
  while (i < text.length) {
    // `{{{` must be tested first: it also starts with `{{`.
    const isParameter = text.startsWith('{{{', i)
    if (isParameter || text.startsWith('{{', i)) {
      const end = findConstructEnd(text, i)
      if (end === -1) {
        out += text[i]
        i++
        continue
      }
      const inner = isParameter ? text.slice(i + 3, end - 3) : text.slice(i + 2, end - 2)
      const missingArgsBefore = ctx.missingArgs
      try {
        out += isParameter ? expandParameter(inner, ctx) : expandCall(inner, ctx)
      } catch (error) {
        // An `#expr` this evaluator cannot handle. Leave the construct alone —
        // never guess a number that becomes a drop rate.
        //
        // Only reported when it happens INSIDE a template being expanded
        // (`depth > 0`), where it means a row's rarity is wrong or missing. At
        // page level it is almost always the page's own average-kill-value
        // arithmetic over live GE prices (`{{#expr:... {{GEP|Abyssal whip}}
        // ...}}`), which this pipeline neither needs nor can evaluate, and
        // which `ev_matches` owns.
        //
        // Also skipped when the expression referenced an argument the page
        // never supplied (`missingArgs` grew while expanding it). That is a
        // template branch this call does not use — `WildernessSlayerDropTable`
        // computes a `combatmax` bound for pages that state a combat-level
        // RANGE, and MediaWiki itself renders an expression error there for
        // the pages that do not, then never reads the result. Reporting it
        // would block eight sources on the wiki's own dead code; the corpus
        // test against the published rarities is what keeps that judgement
        // honest, since a branch that DID matter would show up as a wrong
        // number there.
        if (ctx.depth > 0 && ctx.missingArgs === missingArgsBefore) {
          ctx.unexpandable.push({
            template: inner.slice(0, 40),
            reason: error instanceof Error ? error.message : String(error),
          })
        }
        out += text.slice(i, end)
      }
      i = end
      continue
    }
    out += text[i]
    i++
  }
  return out
}

/**
 * Expands every transclusion in `wikitext` for which a template definition is
 * on disk, leaving everything else exactly as it was.
 */
export function expandTransclusions(
  wikitext: string,
  definitions: TemplateDefinitions
): ExpansionResult {
  const ctx: Context = {
    args: new Map(),
    defs: definitions,
    vars: new Map(),
    expanded: [],
    unexpandable: [],
    depth: 0,
    missingArgs: 0,
    transclusion: null,
  }
  const expanded = expand(wikitext, ctx)
  return { wikitext: expanded, expanded: ctx.expanded, unexpandable: ctx.unexpandable }
}

const TEMPLATE_SNAPSHOT_PREFIX = 'template-'

/**
 * Loads every `Template:` wikitext snapshot on disk, keyed by normalised
 * template name. This map IS the expander's scope — see the module comment.
 */
export async function loadTemplateDefinitions(): Promise<TemplateDefinitions> {
  const definitions = new Map<string, string>()
  for (const key of await listSnapshots('wikitext')) {
    if (!key.startsWith(TEMPLATE_SNAPSHOT_PREFIX)) continue
    const snapshot = await readSnapshot('wikitext', key)
    const page = snapshot.params['page'] ?? ''
    if (!/^template:/i.test(page)) continue
    const body = (snapshot.body as { parse?: { wikitext?: string } }).parse?.wikitext
    if (body === undefined) continue
    definitions.set(normalizeTemplateName(page.replace(/^template:/i, '')), body)
  }
  return definitions
}
