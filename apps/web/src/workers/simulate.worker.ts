import { simulate, type Boss, type SimContext, type SimResult, type Table } from '@osrs-loot-simulator/loot-model'

/**
 * PROJECT_PLAN.md 9: "Run in a Web Worker for anything over ~100k kills. The
 * main thread must stay responsive." Every simulation runs here regardless
 * of `n` — simplest correct rule, and `simulate` is fast enough (section 8:
 * "10M kills should complete in a couple of seconds") that dispatching
 * small runs here too costs nothing noticeable while keeping one code path.
 */

export interface SimulateRequest {
  requestId: number
  boss: Boss
  ctx: SimContext
  seed: number
  n: number
  tables: [string, Table][]
  /** [itemId, price][] — a plain array since a Map of PriceLookup functions can't cross postMessage. */
  prices: [number, number][]
}

export type SimulateResponse =
  | { requestId: number; ok: true; result: SimResult }
  | { requestId: number; ok: false; error: string }

self.onmessage = (event: MessageEvent<SimulateRequest>) => {
  const { requestId, boss, ctx, seed, n, tables, prices } = event.data
  const priceMap = new Map(prices)
  try {
    const result = simulate(boss, n, ctx, seed, {
      tables: new Map(tables),
      prices: (itemId) => (itemId === null ? 0 : (priceMap.get(itemId) ?? 0)),
    })
    const response: SimulateResponse = { requestId, ok: true, result }
    self.postMessage(response)
  } catch (error) {
    const response: SimulateResponse = {
      requestId,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }
    self.postMessage(response)
  }
}
