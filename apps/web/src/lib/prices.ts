import { z } from 'zod'
import type { PriceLookup } from '@osrs-loot-simulator/loot-model'

/**
 * Live GE prices, fetched directly from the browser — same public endpoint
 * `apps/ingest/src/prices/ge-prices.ts` uses server-side (CORS is open:
 * `access-control-allow-origin: *`, confirmed against the live API). No
 * User-Agent header here: browsers refuse to let script code set one, and
 * this is a single user-initiated request per page load, not the ingest
 * pipeline's bulk scrape — the etiquette rules in PROJECT_PLAN.md 6.2 are
 * about that scrape, not this.
 */

export const PRICES_ENDPOINT = 'https://prices.runescape.wiki/api/v1/osrs/latest'

const PriceEntrySchema = z.object({
  high: z.number().nullable().optional(),
  highTime: z.number().nullable().optional(),
  low: z.number().nullable().optional(),
  lowTime: z.number().nullable().optional(),
})
type PriceEntry = z.infer<typeof PriceEntrySchema>
const PricesResponseSchema = z.object({ data: z.record(PriceEntrySchema) })

export type GePrices = ReadonlyMap<number, number>

/**
 * `/latest`'s `high`/`low` are the two most recent individual TRADES, not a
 * spread or a guide price — for a cheap, high-volume item one of them is
 * routinely a single outlier (Cod, id 339: `high: 10000` next to a `low: 21`
 * roughly 12 minutes newer; the live GE box reads 21gp). Averaging the two
 * produced ~5,010gp for a 21gp item. Preferring whichever trade is more
 * recent tracks a real, current price instead of splitting the difference
 * against a stale one. Mirrors `apps/ingest/src/prices/ge-prices.ts`'s
 * `priceOf` — keep the two in sync if this changes again.
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

export async function fetchGePrices(): Promise<GePrices> {
  const response = await fetch(PRICES_ENDPOINT)
  if (!response.ok) throw new Error(`GE prices fetch failed: HTTP ${response.status}`)
  const parsed = PricesResponseSchema.parse(await response.json())
  const prices = new Map<number, number>()
  for (const [idString, entry] of Object.entries(parsed.data)) {
    const itemId = Number(idString)
    if (!Number.isInteger(itemId)) continue
    const price = priceOf(entry)
    if (price !== undefined) prices.set(itemId, price)
  }
  return prices
}

/** Untradeable/unresolved items price at 0 — the same strict join ingest's ev_matches check uses. */
export function gePriceLookup(prices: GePrices): PriceLookup {
  return (itemId) => (itemId === null ? 0 : (prices.get(itemId) ?? 0))
}
