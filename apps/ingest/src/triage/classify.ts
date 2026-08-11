import {
  ALWAYS_RARITY,
  DROP_JSON_FIELDS,
  FRACTION_RARITY,
  VARIANT_MARKERS,
} from '../wiki/fields.js'
import { DropJsonSchema, DropslineRowSchema } from '../wiki/schemas.js'

/**
 * Triage classifies a snapshot by how much work a boss will need. It is
 * deliberately NOT a parser: nothing here produces a canonical `Table`, `Node`
 * or `Rate`. It answers one question per boss — which phase can handle it —
 * by looking at rarity shapes, variant markers and whether any denominator
 * group reconciles.
 */

export const TIERS = ['A', 'B', 'C', 'D', 'E'] as const
export type Tier = (typeof TIERS)[number]

export const TIER_LABELS: Record<Tier, string> = {
  A: 'clean — main table reconciles, no markers, no RDT',
  B: 'variant split — reconciles only after (m)/(f) conditions',
  C: 'shared tables — reaches the rare drop table family',
  D: 'needs review — main table overflows its denominator, or rarities are not fractions',
  E: 'no main table — zero rows, or only Always/one-off rows; the real table is elsewhere',
}

/**
 * A denominator group needs at least this many rows before it is credible as a
 * boss's main weighted table. Below it, a lone `1/100` row is a tertiary drop,
 * not a table.
 */
export const MIN_MAIN_TABLE_ROWS = 3

export interface TriageRow {
  itemName: string
  rarity: string
  numerator: number | null
  denominator: number | null
  isAlways: boolean
  isFraction: boolean
  members: boolean
  freeToPlay: boolean
  rareDropTable: boolean
  rolls: number | null
}

export interface DenominatorGroup {
  denominator: number
  rows: number
  naiveSum: number
  membersSum: number
  freeToPlaySum: number
  /** Sums exactly to the denominator without any membership split. */
  reconcilesFlat: boolean
  /** Both membership variants sum exactly to the denominator. */
  reconcilesSplit: boolean
  /**
   * Fits inside the denominator without a split. The shortfall is the implicit
   * `nothing` remainder (4.3) or an access row rendered elsewhere — both legal.
   * Only overflowing the denominator is evidence of a real problem.
   */
  fitsFlat: boolean
  /** Both membership variants fit inside the denominator. */
  fitsSplit: boolean
}

export interface TriageResult {
  title: string
  slug: string
  tier: Tier
  rowCount: number
  groups: DenominatorGroup[]
  mainDenominator: number | null
  hasVariantMarkers: boolean
  hasRareDropTable: boolean
  alwaysRows: number
  unparseableRarities: string[]
  multiRollRows: number
  reasons: string[]
  bucketError: string | null
  driftKeys: string[]
}

const KNOWN_DROP_JSON_KEYS = new Set<string>(Object.values(DROP_JSON_FIELDS))

function toNumber(value: string): number | null {
  const cleaned = value.replace(/,/g, '')
  const parsed = Number(cleaned)
  return Number.isFinite(parsed) ? parsed : null
}

/** Strip the wiki's HTML so a marker check sees plain text. */
function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, ' ')
}

export function classifyRows(rawRows: unknown[]): {
  rows: TriageRow[]
  unparseableRarities: string[]
  driftKeys: string[]
} {
  const rows: TriageRow[] = []
  const unparseableRarities: string[] = []
  const driftKeys = new Set<string>()

  for (const raw of rawRows) {
    const row = DropslineRowSchema.parse(raw)
    const drop = DropJsonSchema.parse(JSON.parse(row.drop_json))

    for (const key of Object.keys(drop)) {
      if (!KNOWN_DROP_JSON_KEYS.has(key)) driftKeys.add(key)
    }

    const rarity = (drop[DROP_JSON_FIELDS.rarity] ?? '').trim()
    const notes = `${drop[DROP_JSON_FIELDS.nameNotes] ?? ''} ${drop[DROP_JSON_FIELDS.rarityNotes] ?? ''}`
    const plainNotes = stripTags(notes)
    const markerSource = `${notes} ${plainNotes}`

    const fraction = FRACTION_RARITY.exec(rarity)
    const isAlways = ALWAYS_RARITY.test(rarity)
    const numerator = fraction === null ? null : toNumber(fraction[1] ?? '')
    const denominator = fraction === null ? null : toNumber(fraction[2] ?? '')
    const isFraction = numerator !== null && denominator !== null

    if (!isAlways && !isFraction && rarity !== '') unparseableRarities.push(rarity)

    const rollsRaw = drop[DROP_JSON_FIELDS.rolls]
    const rolls =
      typeof rollsRaw === 'number'
        ? rollsRaw
        : typeof rollsRaw === 'string'
          ? toNumber(rollsRaw)
          : null

    rows.push({
      itemName: row.item_name ?? '(unnamed)',
      rarity,
      numerator,
      denominator,
      isAlways,
      isFraction,
      members: VARIANT_MARKERS.members.test(markerSource),
      freeToPlay: VARIANT_MARKERS.freeToPlay.test(markerSource),
      rareDropTable: row.rare_drop_table === true,
      rolls,
    })
  }

  return { rows, unparseableRarities, driftKeys: [...driftKeys].sort() }
}

export function groupByDenominator(rows: readonly TriageRow[]): DenominatorGroup[] {
  const byDenominator = new Map<number, TriageRow[]>()
  for (const row of rows) {
    if (!row.isFraction || row.denominator === null) continue
    const bucket = byDenominator.get(row.denominator) ?? []
    bucket.push(row)
    byDenominator.set(row.denominator, bucket)
  }

  const groups: DenominatorGroup[] = []
  for (const [denominator, groupRows] of byDenominator) {
    let naiveSum = 0
    let membersSum = 0
    let freeToPlaySum = 0
    for (const row of groupRows) {
      const numerator = row.numerator ?? 0
      naiveSum += numerator
      // A row with no marker belongs to both variants; (m) rows are members
      // only and (f) rows are free-to-play only.
      if (!row.freeToPlay) membersSum += numerator
      if (!row.members) freeToPlaySum += numerator
    }
    groups.push({
      denominator,
      rows: groupRows.length,
      naiveSum,
      membersSum,
      freeToPlaySum,
      reconcilesFlat: naiveSum === denominator,
      reconcilesSplit: membersSum === denominator && freeToPlaySum === denominator,
      fitsFlat: naiveSum <= denominator,
      fitsSplit: membersSum <= denominator && freeToPlaySum <= denominator,
    })
  }

  return groups.sort((a, b) => b.rows - a.rows || b.naiveSum - a.naiveSum)
}

/**
 * The candidate main weighted table: the denominator group carrying the most
 * rows. Groups with fewer than `MIN_MAIN_TABLE_ROWS` rows are pre-roll or
 * tertiary drops, which carry no obligation to sum to anything.
 */
export function mainGroup(groups: readonly DenominatorGroup[]): DenominatorGroup | null {
  const candidate = groups[0]
  if (candidate === undefined || candidate.rows < MIN_MAIN_TABLE_ROWS) return null
  return candidate
}

export function classify(input: {
  title: string
  slug: string
  rawRows: unknown[]
  bucketError: string | null
}): TriageResult {
  const { rows, unparseableRarities, driftKeys } = classifyRows(input.rawRows)
  const groups = groupByDenominator(rows)

  const hasVariantMarkers = rows.some((row) => row.members || row.freeToPlay)
  const hasRareDropTable = rows.some((row) => row.rareDropTable)
  const alwaysRows = rows.filter((row) => row.isAlways).length
  const multiRollRows = rows.filter((row) => row.rolls !== null && row.rolls > 1).length

  const main = mainGroup(groups)
  const onlyAlways = rows.length > 0 && rows.every((row) => row.isAlways)

  const reasons: string[] = []
  let tier: Tier

  if (input.bucketError !== null) {
    tier = 'D'
    reasons.push(`bucket error: ${input.bucketError}`)
  } else if (rows.length === 0) {
    tier = 'E'
    reasons.push('no dropsline rows on this page')
  } else if (main === null) {
    tier = 'E'
    reasons.push(
      onlyAlways
        ? `${rows.length} rows, all Always — no weighted table on this page`
        : `no denominator group reaches ${MIN_MAIN_TABLE_ROWS} rows; largest is ` +
          `${groups[0]?.rows ?? 0} row(s) at /${groups[0]?.denominator ?? '—'}`
    )
  } else if (unparseableRarities.length > 0) {
    tier = 'D'
    reasons.push(
      `rarity strings that are not fractions: ${[...new Set(unparseableRarities)].slice(0, 4).join(', ')}`
    )
  } else if (!main.fitsFlat && !main.fitsSplit) {
    tier = 'D'
    reasons.push(
      `main table overflows: ${main.naiveSum}/${main.denominator}, and a membership split ` +
        `does not fix it (members ${main.membersSum}, F2P ${main.freeToPlaySum}) — ` +
        `two tables probably share this denominator`
    )
  } else if (hasRareDropTable) {
    tier = 'C'
    reasons.push(
      `reaches the rare drop table; main table ${main.naiveSum}/${main.denominator}`
    )
  } else if (!main.fitsFlat && main.fitsSplit) {
    tier = 'B'
    reasons.push(
      `members ${main.membersSum}/${main.denominator}, F2P ${main.freeToPlaySum}/${main.denominator}, ` +
        `naive ${main.naiveSum} — only the split reconciles`
    )
  } else if (hasVariantMarkers) {
    tier = 'B'
    reasons.push(
      `markers present; main table ${main.naiveSum}/${main.denominator} already fits flat`
    )
  } else {
    tier = 'A'
    reasons.push(
      main.reconcilesFlat
        ? `${main.naiveSum}/${main.denominator} sums exactly`
        : `${main.naiveSum}/${main.denominator}, shortfall ${main.denominator - main.naiveSum} is implicit nothing`
    )
  }

  if (hasVariantMarkers && tier !== 'B') reasons.push('has (m)/(f) variant markers')
  if (hasRareDropTable && tier !== 'C') reasons.push('has rare drop table rows')
  if (multiRollRows > 0) reasons.push(`${multiRollRows} rows declare rolls > 1`)
  if (driftKeys.length > 0) reasons.push(`unknown drop_json keys: ${driftKeys.join(', ')}`)

  return {
    title: input.title,
    slug: input.slug,
    tier,
    rowCount: rows.length,
    groups,
    mainDenominator: main?.denominator ?? null,
    hasVariantMarkers,
    hasRareDropTable,
    alwaysRows,
    unparseableRarities: [...new Set(unparseableRarities)],
    multiRollRows,
    reasons,
    bucketError: input.bucketError,
    driftKeys,
  }
}
