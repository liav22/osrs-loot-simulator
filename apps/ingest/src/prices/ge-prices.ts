import type { PriceLookup } from '@osrs-loot-simulator/loot-model'
import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import { snapshotPath, writeSnapshot } from '../snapshots/store.js'

/**
 * Live GE prices from the Prices API (PROJECT_PLAN.md 6.1). This is the only
 * source `ev_matches` can use for tradeable items — `dropsline`'s own
 * `Drop Value` field is High Alch, not a market price (see docs/DECISIONS.md,
 * Phase 3 ev_matches investigation).
 */

export const PRICES_ENDPOINT = 'https://prices.runescape.wiki/api/v1/osrs/latest'

const PriceEntrySchema = z.object({
  high: z.number().nullable().optional(),
  highTime: z.number().nullable().optional(),
  low: z.number().nullable().optional(),
  lowTime: z.number().nullable().optional(),
})
export type PriceEntry = z.infer<typeof PriceEntrySchema>

const PricesResponseSchema = z.object({
  data: z.record(PriceEntrySchema),
})

export type GePrices = ReadonlyMap<number, number>

/**
 * `/latest`'s `high`/`low` are the two most recent individual TRADES, not a
 * spread or a guide price — for a cheap, high-volume item (raw fish, runes)
 * one of them is routinely a single outlier (a bot buying a Cod for 10,000
 * coins, timestamped minutes before an ordinary 21gp trade), and averaging
 * the two produces a number neither trade nor the market actually supports.
 * Found on `Cod` (id 339): `high: 10000` at an older timestamp next to
 * `low: 21` roughly 12 minutes newer — averaging gave ~5,010gp against a
 * live GE box reading 21gp. Preferring whichever trade is more recent (not
 * "the higher one" or "the lower one" — the API does not say which side a
 * given trade was) tracks a real, current price instead of splitting the
 * difference between it and a stale one. Likely the same mechanism behind
 * `ev_matches`' previously-unexplained Brutus divergence (docs/DECISIONS.md);
 * not re-investigated here, but this fix applies uniformly, not per-item.
 */
export function priceOf(entry: PriceEntry): number | undefined {
  const high = typeof entry.high === 'number' && Number.isFinite(entry.high) ? entry.high : undefined
  const low = typeof entry.low === 'number' && Number.isFinite(entry.low) ? entry.low : undefined
  if (high === undefined) return low
  if (low === undefined) return high
  const highTime = typeof entry.highTime === 'number' ? entry.highTime : undefined
  const lowTime = typeof entry.lowTime === 'number' ? entry.lowTime : undefined
  if (highTime === undefined || lowTime === undefined || highTime === lowTime) return (high + low) / 2
  return highTime > lowTime ? high : low
}

function toPriceMap(body: unknown): GePrices {
  const parsed = PricesResponseSchema.parse(body)
  const prices = new Map<number, number>()
  for (const [idString, entry] of Object.entries(parsed.data)) {
    const itemId = Number(idString)
    if (!Number.isInteger(itemId)) continue
    const price = priceOf(entry)
    if (price !== undefined) prices.set(itemId, price)
  }
  return prices
}

/**
 * Snapshot-first fetch of every live price, keyed by itemId as mid(high, low).
 * An item absent from the response (untradeable — `gemw=no` items like Bull
 * bones, Mooleta, the Bottomless milk bucket, Beef never appear here) is
 * simply not in the map; callers treat a missing entry as 0, which is what a
 * genuinely untradeable item is worth in GE terms.
 */
export async function fetchGePrices(userAgent: string): Promise<GePrices> {
  const path = snapshotPath('ge-prices', 'latest')
  try {
    const raw = await readFile(path, 'utf8')
    return toPriceMap((JSON.parse(raw) as { body: unknown }).body)
  } catch {
    const response = await fetch(PRICES_ENDPOINT, { headers: { 'User-Agent': userAgent } })
    if (!response.ok) throw new Error(`GE prices fetch failed: HTTP ${response.status}`)
    const body: unknown = await response.json()
    await writeSnapshot('ge-prices', 'latest', {
      endpoint: PRICES_ENDPOINT,
      params: {},
      httpStatus: response.status,
      body,
    })
    return toPriceMap(body)
  }
}

/** Always fetches fresh, bypassing the snapshot — for `--refresh` style runs. */
export async function refetchGePrices(userAgent: string): Promise<GePrices> {
  const response = await fetch(PRICES_ENDPOINT, { headers: { 'User-Agent': userAgent } })
  if (!response.ok) throw new Error(`GE prices fetch failed: HTTP ${response.status}`)
  const body: unknown = await response.json()
  await writeSnapshot('ge-prices', 'latest', {
    endpoint: PRICES_ENDPOINT,
    params: {},
    httpStatus: response.status,
    body,
  })
  return toPriceMap(body)
}

/**
 * `itemId === null` (unresolved — multi-id or not found in the item index)
 * prices at 0, same as an item genuinely absent from the GE. This is a
 * strict join: an item the index cannot resolve to one id is not guessed at,
 * even when one of its several ids happens to carry a live price.
 */
export function gePriceLookup(prices: GePrices): PriceLookup {
  return (itemId) => {
    if (itemId === null) return 0
    return prices.get(itemId) ?? 0
  }
}

