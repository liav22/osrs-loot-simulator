import { BossSchema, type Boss, type BossInput, type PriceLookup } from '../../src/index'

/**
 * Brutus, hand-authored from the live wiki data captured in
 * `data/snapshots/dropsline/brutus.json` (fetched 2026-08-11).
 *
 * Seven wiki headings collapse to four canonical tables. The four cosmetic
 * groupings (Armour, Runes and ammunition, Seeds, Resources, Other) all share
 * denominator 81 and are therefore one weighted table.
 *
 * Weights, verified against the snapshot rather than inferred:
 *
 *   shared           56   armour 6 + runes/ammo 30 + resources 20
 *   members only     25   seeds 15 + t-bone steaks 10
 *   free-to-play     25   coins, in three quantity bands
 *
 *   members  56 + 25 = 81   ✓
 *   F2P      56 + 25 = 81   ✓
 *   naive    56 + 25 + 25 = 106/81   ✗
 *
 * Item ids come from `bucket('item_id')`. Prices are still invented: the wiki's
 * `Drop Value` field is GE-driven and moves, and the real source is the prices
 * API (section 6.1). They are tuned so the members variant lands on the wiki's
 * stated average kill value.
 */

/**
 * The wiki renders "The average Brutus (Members) kill is worth 597.57" via
 * Template:Average drop value. It is not exposed through any bucket and has to
 * be parsed out of the rendered page. Sections 6.4 and 7 of the plan still
 * quote 588.65, which the live page no longer agrees with.
 */
export const BRUTUS_AVERAGE_KILL_VALUE = 597.57

export const BRUTUS_ITEM_IDS = {
  bullBones: 33115,
  rawTBoneSteak: 33106,
  mooleta: 33101,
  bottomlessMilkBucket: 33089,
  cowSlippers: 33093,
  ironFullHelm: 1153,
  ironPlatebody: 1115,
  ironPlatelegs: 1067,
  ironPlateskirt: 1081,
  ironArrow: 884,
  airRune: 556,
  mindRune: 558,
  chaosRune: 562,
  potatoSeed: 5318,
  acorn: 5312,
  cowhide: 1739,
  oakLogs: 1521,
  logs: 1511,
  coins: 995,
  clueScrollBeginner: 23182,
  /**
   * `bucket('item_id')` returns "N/A" for easy clues — the item has many ids,
   * one per scroll step. Phase 5 needs a rule for these; 0 marks it unresolved
   * rather than pretending to a real id.
   */
  clueScrollEasy: 0,
  beef: 33124,
} as const

/**
 * gp per unit. Invented and tuned so the members variant lands on the wiki's
 * stated 597.57, EXCEPT the bottomless milk bucket, which uses the wiki's own
 * `Drop Value` of 9000 because it dominates the figure.
 *
 * Worth knowing: 597.57 cannot be reproduced from the snapshot's own
 * `Drop Value` fields. Summing rarity x Drop Value over the rows gives roughly
 * 268 gp/kill. Clue scrolls are priced 0 here because they are untradeable.
 * Whatever the wiki's template is doing, `ev_matches` cannot simply recompute
 * it from bucket data — see docs/DECISIONS.md.
 */
export const BRUTUS_PRICES: Readonly<Record<number, number>> = {
  [BRUTUS_ITEM_IDS.bullBones]: 62,
  [BRUTUS_ITEM_IDS.rawTBoneSteak]: 74,
  [BRUTUS_ITEM_IDS.mooleta]: 2650,
  [BRUTUS_ITEM_IDS.bottomlessMilkBucket]: 9000,
  [BRUTUS_ITEM_IDS.cowSlippers]: 1500,
  [BRUTUS_ITEM_IDS.ironFullHelm]: 180,
  [BRUTUS_ITEM_IDS.ironPlatebody]: 250,
  [BRUTUS_ITEM_IDS.ironPlatelegs]: 200,
  [BRUTUS_ITEM_IDS.ironPlateskirt]: 160,
  [BRUTUS_ITEM_IDS.ironArrow]: 6,
  [BRUTUS_ITEM_IDS.airRune]: 5,
  [BRUTUS_ITEM_IDS.mindRune]: 4,
  [BRUTUS_ITEM_IDS.chaosRune]: 75,
  [BRUTUS_ITEM_IDS.potatoSeed]: 12,
  [BRUTUS_ITEM_IDS.acorn]: 60,
  [BRUTUS_ITEM_IDS.cowhide]: 140,
  [BRUTUS_ITEM_IDS.oakLogs]: 35,
  [BRUTUS_ITEM_IDS.logs]: 60,
  [BRUTUS_ITEM_IDS.coins]: 1,
  [BRUTUS_ITEM_IDS.clueScrollBeginner]: 0,
  [BRUTUS_ITEM_IDS.clueScrollEasy]: 0,
  [BRUTUS_ITEM_IDS.beef]: 90,
}

export const brutusPrices: PriceLookup = (itemId) => BRUTUS_PRICES[itemId] ?? 0

const MEMBERS_ONLY = [{ kind: 'members', value: true }] as const
const F2P_ONLY = [{ kind: 'members', value: false }] as const

const brutusInput: BossInput = {
  slug: 'brutus',
  name: 'Brutus',
  aliases: [],
  wikiPage: 'Brutus',
  wikiRevId: 0,
  variants: ['normal'],
  status: 'manual_override',
  source: 'override',
  parserVersion: 1,
  contextDefaults: { members: true, variant: 'normal' },
  validation: {
    ok: true,
    checks: [
      { check: 'weights_sum', ok: true, detail: 'members 81/81, F2P 81/81, naive 106' },
      { check: 'ev_matches', ok: true, detail: 'hand-authored against 597.57' },
      { check: 'not_on_watchlist', ok: true },
    ],
  },
  tables: [
    {
      id: 'brutus:always',
      mode: 'always',
      notes: 'Wiki heading "100%".',
      entries: [
        {
          node: {
            kind: 'item',
            itemId: BRUTUS_ITEM_IDS.bullBones,
            name: 'Bull bones',
            qty: { kind: 'exact', n: 1 },
          },
          rate: { kind: 'always' },
        },
        {
          node: {
            kind: 'item',
            itemId: BRUTUS_ITEM_IDS.rawTBoneSteak,
            name: 'Raw t-bone steak',
            qty: { kind: 'exact', n: 1 },
          },
          rate: { kind: 'always' },
        },
      ],
    },
    {
      // 10/150 across three entries, two of them members-only — not the single
      // 1/150 entry the plan's prose implies.
      id: 'brutus:preroll',
      mode: 'preroll',
      notes: 'Wiki heading "Pre-roll". A hit short-circuits the main table.',
      entries: [
        {
          node: {
            kind: 'item',
            itemId: BRUTUS_ITEM_IDS.mooleta,
            name: 'Mooleta',
            qty: { kind: 'exact', n: 1 },
          },
          rate: { kind: 'fixed', num: 5, den: 150 },
        },
        {
          node: {
            kind: 'item',
            itemId: BRUTUS_ITEM_IDS.bottomlessMilkBucket,
            name: 'Bottomless milk bucket (empty)',
            qty: { kind: 'exact', n: 1 },
          },
          rate: { kind: 'fixed', num: 4, den: 150 },
          conditions: [...MEMBERS_ONLY],
        },
        {
          node: {
            kind: 'item',
            itemId: BRUTUS_ITEM_IDS.cowSlippers,
            name: 'Cow slippers',
            qty: { kind: 'exact', n: 1 },
          },
          rate: { kind: 'fixed', num: 1, den: 150 },
          conditions: [...MEMBERS_ONLY],
        },
      ],
    },
    {
      id: 'brutus:main',
      mode: 'weighted',
      denominator: 81,
      notes: 'Headings Armour / Runes and ammunition / Seeds / Resources / Other, one table.',
      entries: [
        // Armour — 6, shared
        {
          node: {
            kind: 'item',
            itemId: BRUTUS_ITEM_IDS.ironFullHelm,
            name: 'Iron full helm',
            qty: { kind: 'exact', n: 1 },
          },
          rate: { kind: 'weight', weight: 2 },
        },
        {
          node: {
            kind: 'item',
            itemId: BRUTUS_ITEM_IDS.ironPlatebody,
            name: 'Iron platebody',
            qty: { kind: 'exact', n: 1 },
          },
          rate: { kind: 'weight', weight: 2 },
        },
        {
          node: {
            kind: 'item',
            itemId: BRUTUS_ITEM_IDS.ironPlatelegs,
            name: 'Iron platelegs',
            qty: { kind: 'exact', n: 1 },
          },
          rate: { kind: 'weight', weight: 1 },
        },
        {
          node: {
            kind: 'item',
            itemId: BRUTUS_ITEM_IDS.ironPlateskirt,
            name: 'Iron plateskirt',
            qty: { kind: 'exact', n: 1 },
          },
          rate: { kind: 'weight', weight: 1 },
        },
        // Runes and ammunition — 30, shared
        {
          node: {
            kind: 'item',
            itemId: BRUTUS_ITEM_IDS.ironArrow,
            name: 'Iron arrow',
            qty: { kind: 'exact', n: 14 },
          },
          rate: { kind: 'weight', weight: 10 },
        },
        {
          node: {
            kind: 'item',
            itemId: BRUTUS_ITEM_IDS.airRune,
            name: 'Air rune',
            qty: { kind: 'exact', n: 29 },
          },
          rate: { kind: 'weight', weight: 10 },
        },
        {
          node: {
            kind: 'item',
            itemId: BRUTUS_ITEM_IDS.mindRune,
            name: 'Mind rune',
            qty: { kind: 'exact', n: 18 },
          },
          rate: { kind: 'weight', weight: 8 },
        },
        {
          node: {
            kind: 'item',
            itemId: BRUTUS_ITEM_IDS.chaosRune,
            name: 'Chaos rune',
            qty: { kind: 'exact', n: 12 },
          },
          rate: { kind: 'weight', weight: 2 },
        },
        // Seeds — 15, members only
        {
          node: {
            kind: 'item',
            itemId: BRUTUS_ITEM_IDS.potatoSeed,
            name: 'Potato seed',
            qty: { kind: 'exact', n: 3 },
          },
          rate: { kind: 'weight', weight: 10 },
          conditions: [...MEMBERS_ONLY],
        },
        {
          node: {
            kind: 'item',
            itemId: BRUTUS_ITEM_IDS.acorn,
            name: 'Acorn',
            qty: { kind: 'exact', n: 2 },
          },
          rate: { kind: 'weight', weight: 5 },
          conditions: [...MEMBERS_ONLY],
        },
        // Three unnoted steaks, members only — not ten noted ones.
        {
          node: {
            kind: 'item',
            itemId: BRUTUS_ITEM_IDS.rawTBoneSteak,
            name: 'Raw t-bone steak',
            qty: { kind: 'exact', n: 3 },
          },
          rate: { kind: 'weight', weight: 10 },
          conditions: [...MEMBERS_ONLY],
        },
        // Resources — 20, shared
        {
          node: {
            kind: 'item',
            itemId: BRUTUS_ITEM_IDS.cowhide,
            name: 'Cowhide',
            qty: { kind: 'exact', n: 1 },
          },
          rate: { kind: 'weight', weight: 10 },
        },
        {
          node: {
            kind: 'item',
            itemId: BRUTUS_ITEM_IDS.oakLogs,
            name: 'Oak logs',
            qty: { kind: 'exact', n: 2 },
          },
          rate: { kind: 'weight', weight: 5 },
        },
        {
          node: {
            kind: 'item',
            itemId: BRUTUS_ITEM_IDS.logs,
            name: 'Logs',
            qty: { kind: 'exact', n: 2 },
          },
          rate: { kind: 'weight', weight: 5 },
        },
        // Other — 25, free-to-play only, in three quantity bands
        {
          node: {
            kind: 'item',
            itemId: BRUTUS_ITEM_IDS.coins,
            name: 'Coins',
            qty: { kind: 'range', min: 60, max: 80 },
          },
          rate: { kind: 'weight', weight: 15 },
          conditions: [...F2P_ONLY],
        },
        {
          node: {
            kind: 'item',
            itemId: BRUTUS_ITEM_IDS.coins,
            name: 'Coins',
            qty: { kind: 'range', min: 80, max: 100 },
          },
          rate: { kind: 'weight', weight: 5 },
          conditions: [...F2P_ONLY],
        },
        {
          node: {
            kind: 'item',
            itemId: BRUTUS_ITEM_IDS.coins,
            name: 'Coins',
            qty: { kind: 'range', min: 100, max: 120 },
          },
          rate: { kind: 'weight', weight: 5 },
          conditions: [...F2P_ONLY],
        },
      ],
    },
    {
      id: 'brutus:tertiary',
      mode: 'independent',
      notes: 'Wiki heading "Tertiary". Stacks with the main drop.',
      entries: [
        {
          node: {
            kind: 'item',
            itemId: BRUTUS_ITEM_IDS.clueScrollBeginner,
            name: 'Clue scroll (beginner)',
            qty: { kind: 'exact', n: 1 },
          },
          rate: { kind: 'fixed', num: 1, den: 15 },
        },
        {
          node: {
            kind: 'item',
            itemId: BRUTUS_ITEM_IDS.clueScrollEasy,
            name: 'Clue scroll (easy)',
            qty: { kind: 'exact', n: 1 },
          },
          rate: { kind: 'fixed', num: 1, den: 40 },
          conditions: [...MEMBERS_ONLY],
        },
        {
          node: {
            kind: 'item',
            itemId: BRUTUS_ITEM_IDS.beef,
            name: 'Beef',
            qty: { kind: 'exact', n: 1 },
          },
          rate: { kind: 'fixed', num: 1, den: 1000 },
          conditions: [...MEMBERS_ONLY],
        },
      ],
    },
  ],
}

export const brutus: Boss = BossSchema.parse(brutusInput)
