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
  low: z.number().nullable().optional(),
})

const PricesResponseSchema = z.object({
  data: z.record(PriceEntrySchema),
})

export type GePrices = ReadonlyMap<number, number>

function toPriceMap(body: unknown): GePrices {
  const parsed = PricesResponseSchema.parse(body)
  const prices = new Map<number, number>()
  for (const [idString, entry] of Object.entries(parsed.data)) {
    const itemId = Number(idString)
    if (!Number.isInteger(itemId)) continue
    const values = [entry.high, entry.low].filter(
      (v): v is number => typeof v === 'number' && Number.isFinite(v)
    )
    if (values.length === 0) continue
    prices.set(itemId, values.reduce((sum, v) => sum + v, 0) / values.length)
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

