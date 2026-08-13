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

const PriceEntrySchema = z.object({ high: z.number().nullable().optional(), low: z.number().nullable().optional() })
const PricesResponseSchema = z.object({ data: z.record(PriceEntrySchema) })

export type GePrices = ReadonlyMap<number, number>

export async function fetchGePrices(): Promise<GePrices> {
  const response = await fetch(PRICES_ENDPOINT)
  if (!response.ok) throw new Error(`GE prices fetch failed: HTTP ${response.status}`)
  const parsed = PricesResponseSchema.parse(await response.json())
  const prices = new Map<number, number>()
  for (const [idString, entry] of Object.entries(parsed.data)) {
    const itemId = Number(idString)
    if (!Number.isInteger(itemId)) continue
    const values = [entry.high, entry.low].filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
    if (values.length === 0) continue
    prices.set(itemId, values.reduce((sum, v) => sum + v, 0) / values.length)
  }
  return prices
}

/** Untradeable/unresolved items price at 0 — the same strict join ingest's ev_matches check uses. */
export function gePriceLookup(prices: GePrices): PriceLookup {
  return (itemId) => (itemId === null ? 0 : (prices.get(itemId) ?? 0))
}
