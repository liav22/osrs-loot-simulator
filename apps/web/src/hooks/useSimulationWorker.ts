import { useCallback, useEffect, useRef, useState } from 'react'
import type { Boss, SimContext, SimResult, Table } from '@osrs-loot-simulator/loot-model'
import type { SimulateRequest, SimulateResponse } from '../workers/simulate.worker'

export interface RunSimulationArgs {
  boss: Boss
  ctx: SimContext
  seed: number
  n: number
  tables: ReadonlyMap<string, Table>
  prices: ReadonlyMap<number, number>
}

export type SimulationState =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'done'; result: SimResult }
  | { status: 'error'; message: string }

/**
 * Owns one `simulate.worker.ts` instance for the component's lifetime.
 * `run` is safe to call again before a previous run finishes — only the
 * latest request's response is accepted, so a fast re-click (new context,
 * new seed) can't have an old result clobber a newer one arriving out of
 * order.
 */
export function useSimulationWorker(): { state: SimulationState; run: (args: RunSimulationArgs) => void } {
  const workerRef = useRef<Worker | null>(null)
  const latestRequestId = useRef(0)
  const [state, setState] = useState<SimulationState>({ status: 'idle' })

  useEffect(() => {
    const worker = new Worker(new URL('../workers/simulate.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<SimulateResponse>) => {
      const response = event.data
      if (response.requestId !== latestRequestId.current) return // stale
      setState(response.ok ? { status: 'done', result: response.result } : { status: 'error', message: response.error })
    }
    workerRef.current = worker
    return () => worker.terminate()
  }, [])

  const run = useCallback((args: RunSimulationArgs) => {
    const worker = workerRef.current
    if (worker === null) return
    const requestId = ++latestRequestId.current
    setState({ status: 'running' })
    const request: SimulateRequest = {
      requestId,
      boss: args.boss,
      ctx: args.ctx,
      seed: args.seed,
      n: args.n,
      tables: [...args.tables.entries()],
      prices: [...args.prices.entries()],
    }
    worker.postMessage(request)
  }, [])

  return { state, run }
}
