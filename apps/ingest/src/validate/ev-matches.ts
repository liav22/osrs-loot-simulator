import type { Boss, PriceLookup, SimContext, Table } from '@osrs-loot-simulator/loot-model'
import { expectedValue } from '@osrs-loot-simulator/loot-model'

/**
 * The `ev_matches` check (PROJECT_PLAN.md 7): simulated (here, analytic)
 * gp/kill is within 2% of the wiki's stated average kill value.
 *
 * Rendered via `Template:Average drop value`; not exposed by any bucket, so
 * the figure has to be read out of the rendered page (`action=parse&prop=text`).
 * See docs/DECISIONS.md for the investigation establishing that this figure
 * cannot be reproduced from `dropsline`'s own `Drop Value` field (which is
 * High Alch, not a GE price) — it requires live GE prices.
 */

const AVERAGE_KILL_VALUE = /average\s+\S+[^.]*?kill\s+is\s+worth\s+([\d,]+(?:\.\d+)?)/i

export function extractAverageKillValue(renderedHtml: string): number | null {
  const text = renderedHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
  const match = AVERAGE_KILL_VALUE.exec(text)
  if (match === null) return null
  const value = Number((match[1] ?? '').replace(/,/g, ''))
  return Number.isFinite(value) ? value : null
}

export const EV_MATCHES_TOLERANCE = 0.02

export interface EvMatchesResult {
  check: 'ev_matches'
  ok: boolean
  detail: string
  gpPerKill?: number
  wikiValue?: number
}

export function checkEvMatches(
  boss: Boss,
  ctx: SimContext,
  prices: PriceLookup,
  renderedHtml: string | null,
  sharedTables: ReadonlyMap<string, Table> = new Map()
): EvMatchesResult {
  if (renderedHtml === null) {
    return {
      check: 'ev_matches',
      ok: false,
      detail: 'no rendered page snapshot available to read the average kill value from',
    }
  }
  const wikiValue = extractAverageKillValue(renderedHtml)
  if (wikiValue === null) {
    return {
      check: 'ev_matches',
      ok: false,
      detail: 'the rendered page has no "average ... kill is worth N" sentence to compare against',
    }
  }

  const { gpPerKill } = expectedValue(boss, ctx, { prices, tables: sharedTables })
  const relativeError = Math.abs(gpPerKill - wikiValue) / wikiValue
  const ok = relativeError <= EV_MATCHES_TOLERANCE

  return {
    check: 'ev_matches',
    ok,
    detail: ok
      ? `${gpPerKill.toFixed(2)} gp/kill vs wiki's ${wikiValue}, within ${(EV_MATCHES_TOLERANCE * 100).toFixed(0)}%`
      : `${gpPerKill.toFixed(2)} gp/kill vs wiki's ${wikiValue}, ${(relativeError * 100).toFixed(1)}% off`,
    gpPerKill,
    wikiValue,
  }
}
