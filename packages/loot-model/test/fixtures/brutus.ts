import { BossSchema, type Boss, type BossInput, type PriceLookup } from '../../src/index'

/**
 * Brutus, hand-authored from PROJECT_PLAN.md section 6.4. Seven wiki headings
 * collapse to four canonical tables; the four cosmetic groupings (Armour,
 * Runes and ammunition, Seeds, Resources, Other) all share denominator 81 and
 * are therefore one weighted table.
 *
 * Weight reconstruction, so the arithmetic is auditable:
 *
 *   armour           6   shared
 *   runes           30   shared
 *   seeds           15   members only
 *   noted steaks    10   members only
 *   other resources 20   shared
 *   coins           25   F2P only
 *
 *   members  6 + 30 + 15 + 10 + 20 = 81   ✓
 *   F2P      6 + 30 + 20 + 25      = 81   ✓
 *   naive    6 + 30 + 15 + 10 + 20 + 25 = 106/81   ✗
 *
 * Section 6.4 states "resources 30" for members and "coins 25 (replacing seeds
 * 15 and noted steaks 10)" for F2P. Taken literally the F2P line reads
 * 6 + 30 + 25 = 61, not 81. The split above is the only reading that satisfies
 * all three of the plan's stated totals (81 / 81 / 106); see docs/DECISIONS.md.
 *
 * Item ids, quantities and prices are invented — section 6.4 gives structure
 * and weights only. Phase 2 replaces them from the wiki.
 */

export const BRUTUS_AVERAGE_KILL_VALUE = 588.65

export const BRUTUS_ITEM_IDS = {
  bullBones: 30021,
  rawTBoneSteak: 30023,
  bullHorn: 30025,
  ironPlatebody: 1115,
  steelFullHelm: 1157,
  airRune: 556,
  fireRune: 554,
  deathRune: 560,
  guamSeed: 5291,
  ranarrSeed: 5295,
  snapdragonSeed: 5300,
  coal: 453,
  ironOre: 440,
  coins: 995,
  clueScrollHard: 2722,
  rawBeef: 2132,
} as const

/** gp per unit. Invented for the fixture; the real source is the prices API (6.1). */
export const BRUTUS_PRICES: Readonly<Record<number, number>> = {
  [BRUTUS_ITEM_IDS.bullBones]: 40,
  [BRUTUS_ITEM_IDS.rawTBoneSteak]: 60,
  [BRUTUS_ITEM_IDS.bullHorn]: 6000,
  [BRUTUS_ITEM_IDS.ironPlatebody]: 150,
  [BRUTUS_ITEM_IDS.steelFullHelm]: 250,
  [BRUTUS_ITEM_IDS.airRune]: 4,
  [BRUTUS_ITEM_IDS.fireRune]: 5,
  [BRUTUS_ITEM_IDS.deathRune]: 180,
  [BRUTUS_ITEM_IDS.guamSeed]: 12,
  [BRUTUS_ITEM_IDS.ranarrSeed]: 1265,
  [BRUTUS_ITEM_IDS.snapdragonSeed]: 900,
  [BRUTUS_ITEM_IDS.coal]: 35,
  [BRUTUS_ITEM_IDS.ironOre]: 18,
  [BRUTUS_ITEM_IDS.coins]: 1,
  [BRUTUS_ITEM_IDS.clueScrollHard]: 6000,
  [BRUTUS_ITEM_IDS.rawBeef]: 8,
}

export const brutusPrices: PriceLookup = (itemId) => BRUTUS_PRICES[itemId] ?? 0

const MEMBERS_ONLY = [{ kind: 'members', value: true }] as const
const F2P_ONLY = [{ kind: 'members', value: false }] as const

const brutusInput: BossInput = {
  slug: 'brutus',
  name: 'Brutus',
  aliases: ['brutus the bull'],
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
      { check: 'weights_sum', ok: true, detail: 'members 81/81, F2P 81/81' },
      { check: 'ev_matches', ok: true, detail: 'hand-authored against 588.65' },
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
      id: 'brutus:preroll',
      mode: 'preroll',
      notes: 'Wiki heading "Pre-roll". A hit short-circuits the main table.',
      entries: [
        {
          node: {
            kind: 'item',
            itemId: BRUTUS_ITEM_IDS.bullHorn,
            name: "Brutus' horn",
            qty: { kind: 'exact', n: 1 },
          },
          rate: { kind: 'fixed', num: 1, den: 150 },
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
            itemId: BRUTUS_ITEM_IDS.ironPlatebody,
            name: 'Iron platebody',
            qty: { kind: 'exact', n: 1 },
          },
          rate: { kind: 'weight', weight: 3 },
        },
        {
          node: {
            kind: 'item',
            itemId: BRUTUS_ITEM_IDS.steelFullHelm,
            name: 'Steel full helm',
            qty: { kind: 'exact', n: 1 },
          },
          rate: { kind: 'weight', weight: 3 },
        },
        // Runes and ammunition — 30, shared
        {
          node: {
            kind: 'item',
            itemId: BRUTUS_ITEM_IDS.airRune,
            name: 'Air rune',
            qty: { kind: 'exact', n: 50 },
          },
          rate: { kind: 'weight', weight: 15 },
        },
        {
          node: {
            kind: 'item',
            itemId: BRUTUS_ITEM_IDS.fireRune,
            name: 'Fire rune',
            qty: { kind: 'exact', n: 30 },
          },
          rate: { kind: 'weight', weight: 10 },
        },
        {
          node: {
            kind: 'item',
            itemId: BRUTUS_ITEM_IDS.deathRune,
            name: 'Death rune',
            qty: { kind: 'exact', n: 3 },
          },
          rate: { kind: 'weight', weight: 5 },
        },
        // Seeds — 15, members only
        {
          node: {
            kind: 'item',
            itemId: BRUTUS_ITEM_IDS.guamSeed,
            name: 'Guam seed',
            qty: { kind: 'exact', n: 8 },
          },
          rate: { kind: 'weight', weight: 8 },
          conditions: [...MEMBERS_ONLY],
        },
        {
          node: {
            kind: 'item',
            itemId: BRUTUS_ITEM_IDS.ranarrSeed,
            name: 'Ranarr seed',
            qty: { kind: 'exact', n: 1 },
          },
          rate: { kind: 'weight', weight: 5 },
          conditions: [...MEMBERS_ONLY],
        },
        {
          node: {
            kind: 'item',
            itemId: BRUTUS_ITEM_IDS.snapdragonSeed,
            name: 'Snapdragon seed',
            qty: { kind: 'exact', n: 1 },
          },
          rate: { kind: 'weight', weight: 2 },
          conditions: [...MEMBERS_ONLY],
        },
        // Resources — 10 noted steaks (members only) + 20 shared
        {
          node: {
            kind: 'item',
            itemId: BRUTUS_ITEM_IDS.rawTBoneSteak,
            name: 'Raw t-bone steak',
            qty: { kind: 'exact', n: 10 },
            noted: true,
          },
          rate: { kind: 'weight', weight: 10 },
          conditions: [...MEMBERS_ONLY],
        },
        {
          node: {
            kind: 'item',
            itemId: BRUTUS_ITEM_IDS.coal,
            name: 'Coal',
            qty: { kind: 'exact', n: 15 },
          },
          rate: { kind: 'weight', weight: 10 },
        },
        {
          node: {
            kind: 'item',
            itemId: BRUTUS_ITEM_IDS.ironOre,
            name: 'Iron ore',
            qty: { kind: 'exact', n: 20 },
          },
          rate: { kind: 'weight', weight: 10 },
        },
        // Other — 25, F2P only, replacing seeds and noted steaks
        {
          node: {
            kind: 'item',
            itemId: BRUTUS_ITEM_IDS.coins,
            name: 'Coins',
            qty: { kind: 'choice', values: [250, 400, 550] },
          },
          rate: { kind: 'weight', weight: 25 },
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
            itemId: BRUTUS_ITEM_IDS.clueScrollHard,
            name: 'Clue scroll (hard)',
            qty: { kind: 'exact', n: 1 },
          },
          rate: { kind: 'fixed', num: 1, den: 128 },
          conditions: [...MEMBERS_ONLY],
        },
        {
          node: {
            kind: 'item',
            itemId: BRUTUS_ITEM_IDS.rawBeef,
            name: 'Raw beef',
            qty: { kind: 'range', min: 20, max: 40 },
          },
          rate: { kind: 'fixed', num: 1, den: 32 },
        },
      ],
    },
  ],
}

export const brutus: Boss = BossSchema.parse(brutusInput)
