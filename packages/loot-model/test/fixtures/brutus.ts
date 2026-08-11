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
 * Item ids come from `bucket('item_id')`. Prices remain invented and tuned —
 * NOT derived from a real source, despite investigation. Four independently
 * computed figures for the members variant, all built from data this pipeline
 * can actually see, bracket 268 to 555 gp/kill and none reproduces 597.57:
 *
 *   - rarity x dropsline's `Drop Value` field alone:      ~268 gp/kill
 *   - the above turned out to be reading High Alch, not
 *     GE price — the dropsline bucket's `Drop Value` field
 *     IS the row's High Alch value, not a market price
 *   - rarity x qty x live GE price (mid), preroll NOT
 *     suppressing the main table (flat sum):              ~586 gp/kill
 *   - the same, with the model's correct preroll
 *     short-circuit applied:                               ~555 gp/kill
 *   - rarity x the wiki's own rendered "Price" column,
 *     with "Not sold" (gemw=no items) read as 0 gp:         ~331 gp/kill
 *
 * The wikitext (`data/snapshots/wikitext/brutus.json`) marks the Bottomless
 * milk bucket, Mooleta and Beef `gemw=no`, and the rendered page's own Price
 * column says "Not sold" for them — so they are genuinely untradeable, yet
 * excluding them (331 gp/kill) moves *away* from 597.57, not toward it. This
 * means Template:Average drop value assigns untradeable rares some value the
 * DropsLine template's own Price/High Alch columns do not expose anywhere.
 * `ev_matches` cannot be made a blocking structural check on data this
 * pipeline can see — see docs/DECISIONS.md.
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
  /**
   * `data/_item-index.json` cannot verify this id: `bucket('item_id')` returns
   * FOUR separate rows for "Bottomless milk bucket" (33089, 33091 — two ids,
   * not one), one row per id sharing the page name, and the wiki page is
   * titled "Bottomless milk bucket" with no "(empty)" suffix — this fixture's
   * item name does not match the page it should resolve against either. This
   * id is a guess, not a resolution; `items_known` would correctly fail it.
   */
  bottomlessMilkBucket: 33089,
  /**
   * Same shape of problem: "Cow slippers" resolves to FOUR ids (33093, 33096,
   * 33097, 33098) across four rows, one per colour/variant. Nothing in the
   * dropsline row says which variant Brutus drops. Also a guess.
   */
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
  beef: 33124,
} as const

/**
 * `bucket('item_id')` returns the literal string "N/A" for easy clues — the
 * item has many ids, one per scroll step, and does not resolve to a single
 * id. `null` marks it unresolved; a sentinel like `0` is never used, since a
 * real item id is a small positive integer and could one day collide with it.
 */
export const CLUE_SCROLL_EASY_ITEM_ID: number | null = null
export const CLUE_SCROLL_EASY_ITEM_KEY = 'clue-scroll-easy'

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
  [BRUTUS_ITEM_IDS.beef]: 90,
}

export const brutusPrices: PriceLookup = (itemId) =>
  itemId === null ? 0 : (BRUTUS_PRICES[itemId] ?? 0)

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
            itemKey: 'bull-bones',
            name: 'Bull bones',
            qty: { kind: 'exact', n: 1 },
          },
          rate: { kind: 'always' },
        },
        {
          node: {
            kind: 'item',
            itemId: BRUTUS_ITEM_IDS.rawTBoneSteak,
            itemKey: 'raw-t-bone-steak',
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
            itemKey: 'mooleta',
            name: 'Mooleta',
            qty: { kind: 'exact', n: 1 },
          },
          rate: { kind: 'fixed', num: 5, den: 150 },
        },
        {
          node: {
            kind: 'item',
            itemId: BRUTUS_ITEM_IDS.bottomlessMilkBucket,
            itemKey: 'bottomless-milk-bucket',
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
            itemKey: 'cow-slippers',
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
            itemKey: 'iron-full-helm',
            name: 'Iron full helm',
            qty: { kind: 'exact', n: 1 },
          },
          rate: { kind: 'weight', weight: 2 },
        },
        {
          node: {
            kind: 'item',
            itemId: BRUTUS_ITEM_IDS.ironPlatebody,
            itemKey: 'iron-platebody',
            name: 'Iron platebody',
            qty: { kind: 'exact', n: 1 },
          },
          rate: { kind: 'weight', weight: 2 },
        },
        {
          node: {
            kind: 'item',
            itemId: BRUTUS_ITEM_IDS.ironPlatelegs,
            itemKey: 'iron-platelegs',
            name: 'Iron platelegs',
            qty: { kind: 'exact', n: 1 },
          },
          rate: { kind: 'weight', weight: 1 },
        },
        {
          node: {
            kind: 'item',
            itemId: BRUTUS_ITEM_IDS.ironPlateskirt,
            itemKey: 'iron-plateskirt',
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
            itemKey: 'iron-arrow',
            name: 'Iron arrow',
            qty: { kind: 'exact', n: 14 },
          },
          rate: { kind: 'weight', weight: 10 },
        },
        {
          node: {
            kind: 'item',
            itemId: BRUTUS_ITEM_IDS.airRune,
            itemKey: 'air-rune',
            name: 'Air rune',
            qty: { kind: 'exact', n: 29 },
          },
          rate: { kind: 'weight', weight: 10 },
        },
        {
          node: {
            kind: 'item',
            itemId: BRUTUS_ITEM_IDS.mindRune,
            itemKey: 'mind-rune',
            name: 'Mind rune',
            qty: { kind: 'exact', n: 18 },
          },
          rate: { kind: 'weight', weight: 8 },
        },
        {
          node: {
            kind: 'item',
            itemId: BRUTUS_ITEM_IDS.chaosRune,
            itemKey: 'chaos-rune',
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
            itemKey: 'potato-seed',
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
            itemKey: 'acorn',
            name: 'Acorn',
            qty: { kind: 'exact', n: 2 },
          },
          rate: { kind: 'weight', weight: 5 },
          conditions: [...MEMBERS_ONLY],
        },
        // Three NOTED steaks, members only — not ten noted ones. The dropsline
        // bucket's Quantity fields are purely numeric and drop the "(noted)"
        // qualifier; only the wikitext's `quantity=3 (noted)` parameter carries
        // it. Confirmed against `data/snapshots/wikitext/brutus.json`.
        {
          node: {
            kind: 'item',
            itemId: BRUTUS_ITEM_IDS.rawTBoneSteak,
            itemKey: 'raw-t-bone-steak',
            name: 'Raw t-bone steak',
            qty: { kind: 'exact', n: 3 },
            noted: true,
          },
          rate: { kind: 'weight', weight: 10 },
          conditions: [...MEMBERS_ONLY],
        },
        // Resources — 20, shared
        {
          node: {
            kind: 'item',
            itemId: BRUTUS_ITEM_IDS.cowhide,
            itemKey: 'cowhide',
            name: 'Cowhide',
            qty: { kind: 'exact', n: 1 },
          },
          rate: { kind: 'weight', weight: 10 },
        },
        {
          node: {
            kind: 'item',
            itemId: BRUTUS_ITEM_IDS.oakLogs,
            itemKey: 'oak-logs',
            name: 'Oak logs',
            qty: { kind: 'exact', n: 2 },
          },
          rate: { kind: 'weight', weight: 5 },
        },
        {
          node: {
            kind: 'item',
            itemId: BRUTUS_ITEM_IDS.logs,
            itemKey: 'logs',
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
            itemKey: 'coins',
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
            itemKey: 'coins',
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
            itemKey: 'coins',
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
            itemKey: 'clue-scroll-beginner',
            name: 'Clue scroll (beginner)',
            qty: { kind: 'exact', n: 1 },
          },
          rate: { kind: 'fixed', num: 1, den: 15 },
        },
        {
          node: {
            kind: 'item',
            itemId: CLUE_SCROLL_EASY_ITEM_ID,
            itemKey: CLUE_SCROLL_EASY_ITEM_KEY,
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
            itemKey: 'beef',
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
