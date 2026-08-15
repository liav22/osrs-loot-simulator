import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { expectedValue, type ExpectedValueResult } from '@osrs-loot-simulator/loot-model'
import { useBoss, useSharedTables } from '../hooks/useBoss'
import { useSimulationWorker } from '../hooks/useSimulationWorker'
import { useGePrices } from '../hooks/useGePrices'
import { useSiteIndex } from '../hooks/useSiteIndex'
import { gePriceLookup } from '../lib/prices'
import { paramsFromSearch, RANDOM_SEED, rollSeed, searchFromParams, type SimRunParams } from '../lib/url-state'
import { BossPanel } from './BossPanel'
import { SimResultsView } from './SimResultsView'

export function BossView({ slug }: { slug: string }) {
  const bossQuery = useBoss(slug)
  const tablesQuery = useSharedTables()
  const pricesQuery = useGePrices()
  const indexQuery = useSiteIndex()
  const [searchParams, setSearchParams] = useSearchParams()
  const [params, setParams] = useState<SimRunParams>(() => paramsFromSearch(searchParams))
  const { state: simState, run } = useSimulationWorker()

  // Reads the URL's params once, on mount. Deliberately keyed on `slug`
  // alone, not `searchParams`: HomePage remounts this component with a
  // fresh `key={slug}` on every navigation (pages/HomePage.tsx), so `slug`
  // is stable for the component's whole lifetime and this only ever runs
  // once per mount — it must NOT also depend on `searchParams`, since
  // `updateParams` writes both local state and the URL on every user edit,
  // and re-running this from that same `searchParams` change would fight
  // the state it just set (no react-hooks/exhaustive-deps lint is
  // configured in this repo to flag the "missing" dependency).
  useEffect(() => {
    setParams(paramsFromSearch(searchParams))
  }, [slug])

  function updateParams(next: SimRunParams) {
    setParams(next)
    setSearchParams(searchFromParams(next), { replace: true })
  }

  const expected: ExpectedValueResult | undefined = useMemo(() => {
    if (bossQuery.data === undefined || tablesQuery.data === undefined) return undefined
    try {
      return expectedValue(bossQuery.data, params.ctx, {
        tables: tablesQuery.data,
        prices: pricesQuery.data !== undefined ? gePriceLookup(pricesQuery.data) : undefined,
      })
    } catch {
      return undefined
    }
  }, [bossQuery.data, tablesQuery.data, pricesQuery.data, params.ctx])

  /**
   * Whether the run currently on screen was priced — a property of that run,
   * not of the price query right now.
   *
   * These come apart, and it is not a corner case. Simulate is no longer
   * disabled while the GE fetch is in flight, so an early click runs against
   * an empty price map; if the fetch then lands a second later, asking the
   * live query would label an all-zero grid "sorted by total value". Recording
   * what the run actually used is what keeps the label honest.
   */
  const [ranWithPrices, setRanWithPrices] = useState(false)

  const runWith = useCallback(
    (next: SimRunParams) => {
      if (bossQuery.data === undefined || tablesQuery.data === undefined) return
      const prices = pricesQuery.data ?? new Map<number, number>()
      setRanWithPrices(prices.size > 0)
      run({
        boss: bossQuery.data,
        ctx: next.ctx,
        seed: next.seed,
        n: next.kills,
        tables: tablesQuery.data,
        prices,
      })
    },
    [bossQuery.data, tablesQuery.data, pricesQuery.data, run]
  )

  /**
   * Re-run a shared link on arrival, exactly once.
   *
   * The ref, not a piece of state: `runWith` changes identity whenever the
   * price query settles, and without the latch that would re-fire the
   * simulation underneath someone who had already changed the controls.
   */
  const autoRan = useRef(false)

  function handleSimulate() {
    // A seed of 0 means "roll one". The rolled value goes to the worker and
    // into the URL, but NOT into `params` — the input keeps showing 0 so the
    // next click rolls again instead of repeating this run.
    //
    // This is why the URL is written from a different object than the state:
    // the link has to carry a real seed to replay, while the control has to
    // keep carrying the sentinel.
    const next = { ...params, run: true }
    const effective = { ...next, seed: next.seed === RANDOM_SEED ? rollSeed() : next.seed }

    // Claim the auto-run latch. Pressing Simulate is what first sets `run` on
    // the params, and the auto-run effect watches exactly that — so without
    // this the click dispatches a run and the effect immediately dispatches a
    // second one. That was invisible while every run used the seed sitting in
    // the input (two identical runs, the later one winning), and became
    // visible the moment the seed was rolled per run: the URL carried the
    // click's seed and the results carried the effect's.
    autoRan.current = true

    setParams(next)
    setSearchParams(searchFromParams(effective), { replace: true })
    runWith(effective)
  }

  useEffect(() => {
    if (autoRan.current || !params.run) return
    if (bossQuery.data === undefined || tablesQuery.data === undefined) return
    // Wait for the GE fetch to settle first. A click is user-initiated and
    // should be instant, so it runs with whatever prices exist; an auto-run
    // has nobody waiting on it and no reason to race. Without this, EVERY
    // shared link lost the race and rendered "0 gp total" with the grid
    // sorted by rarity — technically labelled, but a poor answer for the one
    // feature whose whole point is showing someone else your result.
    //
    // `isLoading`, not `data !== undefined`: a failed fetch must not hang the
    // run forever. It settles to not-loading with no data, and the rarity
    // fallback takes over exactly as it does for a click.
    if (pricesQuery.isLoading) return
    autoRan.current = true
    // Every link this app produces carries a real seed, so the sentinel branch
    // is only reachable on a hand-edited `?run=1&seed=0`. Rolling is the right
    // reading of that link — "run one" — rather than seeding the RNG with 0.
    runWith(params.seed === RANDOM_SEED ? { ...params, seed: rollSeed() } : params)
  }, [params, bossQuery.data, tablesQuery.data, pricesQuery.isLoading, runWith])

  if (bossQuery.isLoading) return <p className="p-4 text-sm text-muted">Loading {slug}…</p>
  if (bossQuery.isError) {
    return (
      <p className="p-4 text-sm text-red-400">
        Could not load "{slug}": {(bossQuery.error as Error).message}
      </p>
    )
  }
  if (bossQuery.data === undefined) return null
  const boss = bossQuery.data

  const image = indexQuery.data?.entries.find((entry) => entry.slug === slug)?.image

  return (
    // Section 8's three breakpoints, spelled out rather than approximated with
    // Tailwind's defaults (which land on 1024, not 900):
    //   <900px    one column, page scrolls
    //   900-1200  two columns, boss panel narrow
    //   >=1200    two columns, boss panel at full width
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 p-3 min-[900px]:grid-cols-[260px_minmax(0,1fr)] min-[900px]:overflow-hidden min-[900px]:p-4 min-[1200px]:grid-cols-[320px_minmax(0,1fr)]">
      <div className="min-h-0 min-[900px]:overflow-hidden">
        <BossPanel
          boss={boss}
          image={image}
          sharedTables={tablesQuery.data}
          params={params}
          onChange={updateParams}
          onSimulate={handleSimulate}
          running={simState.status === 'running'}
        />
      </div>

      <section
        data-testid="results"
        className="flex min-h-0 flex-col rounded-md border border-neutral-800 bg-neutral-950 p-3"
      >
        {/* Screen-reader only: the section needs a name, but a visible
            "Results" title would spend a line of the region the whole rework
            is trying to give more room to. */}
        <h2 className="sr-only">Results</h2>
        {simState.status === 'error' && (
          <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            Simulation failed: {simState.message}
          </p>
        )}
        {/* An empty state, not a collapsed panel — the two columns are the same
            height before and after a run, so nothing jumps when results land. */}
        {simState.status === 'idle' && (
          <div className="flex flex-1 items-center justify-center px-6 text-center">
            <p className="text-sm text-muted">
              Set the kill count and press Simulate.
              <br />
              Results appear here.
            </p>
          </div>
        )}
        {simState.status === 'running' && (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-sm text-muted">Simulating…</p>
          </div>
        )}
        {simState.status === 'done' && (
          <SimResultsView
            boss={boss}
            result={simState.result}
            expected={expected}
            pricesAvailable={ranWithPrices}
          />
        )}
      </section>
    </div>
  )
}
