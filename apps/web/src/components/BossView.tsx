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

  /**
   * Re-parses once the boss's `contextDefaults` are known, purely so the
   * controls (the delve-level input, the variant dropdown, ...) DISPLAY the
   * value a run actually uses instead of the package-wide default they were
   * seeded with before the boss loaded. `effectiveCtx` below is already
   * correct for simulating without this — the mount-time parse above cannot
   * see `contextDefaults` because the boss hasn't loaded yet, and nothing
   * renders an editable control before it does, so this is a one-time,
   * user-invisible catch-up rather than something that could race a click.
   */
  const contextDefaultsApplied = useRef(false)
  useEffect(() => {
    if (contextDefaultsApplied.current || bossQuery.data === undefined) return
    contextDefaultsApplied.current = true
    setParams(paramsFromSearch(searchParams, bossQuery.data.contextDefaults))
  }, [bossQuery.data])

  function updateParams(next: SimRunParams) {
    setParams(next)
    setSearchParams(searchFromParams(next, bossQuery.data?.contextDefaults), { replace: true })
  }

  /**
   * `params.ctx` alone is not enough to simulate or score a run: it is built
   * by `paramsFromSearch` from the URL, and at the moment that first runs the
   * boss has not loaded yet, so any field a user didn't specify falls back to
   * the package-wide `DEFAULT_SIM_CONTEXT` rather than THIS boss's own
   * `contextDefaults` — Vorkath's `variant: 'Post-quest'`, Zalcano's damage
   * inputs, ancient chest's `points`. Left uncorrected, every entry gated on
   * one of those fields is silently unreachable and a default run returns no
   * drops at all.
   *
   * Recomputed here, synchronously at render time from `searchParams` (not
   * from `params.ctx`), rather than patched into `params` via an effect once
   * the boss loads: an effect's correction lands a render after it fires,
   * which is too late for the auto-run effect below — on the very render
   * where `bossQuery.data` first arrives, auto-run and any correction effect
   * both close over the SAME stale `params`, and auto-run would already have
   * fired (and latched) using it. `searchParams` carries no such lag — a
   * shared link's query string is exactly what `paramsFromSearch` needs on
   * the first render `bossQuery.data` exists, so this is correct immediately,
   * with nothing to race. `updateParams`/`handleSimulate` always write
   * `params` and `searchParams` together from the same object, so this stays
   * equal to `params.ctx` for every field a user (or link) actually set.
   */
  const effectiveCtx = useMemo(
    () => paramsFromSearch(searchParams, bossQuery.data?.contextDefaults).ctx,
    [searchParams, bossQuery.data]
  )

  const expected: ExpectedValueResult | undefined = useMemo(() => {
    if (bossQuery.data === undefined || tablesQuery.data === undefined) return undefined
    try {
      return expectedValue(bossQuery.data, effectiveCtx, {
        tables: tablesQuery.data,
        prices: pricesQuery.data !== undefined ? gePriceLookup(pricesQuery.data) : undefined,
      })
    } catch {
      return undefined
    }
  }, [bossQuery.data, tablesQuery.data, pricesQuery.data, effectiveCtx])

  /**
   * Whether the run currently on screen was priced — a property of that run,
   * not of the price query right now.
   *
   * This must be recorded synchronously when the simulation is dispatched, not
   * in a separate React state update that can lag behind the worker result.
   * The price query can settle after the run has already landed, and the UI
   * needs to label the result with the prices that actually ran, not the ones
   * that happen to exist a moment later.
   */
  const ranWithPricesRef = useRef(false)

  const runWith = useCallback(
    (next: SimRunParams) => {
      if (bossQuery.data === undefined || tablesQuery.data === undefined) return
      const prices = pricesQuery.data ?? new Map<number, number>()
      ranWithPricesRef.current = prices.size > 0
      run({
        boss: bossQuery.data,
        // `effectiveCtx`, not `next.ctx`: every caller builds `next` from
        // `params` with only `seed`/`run` touched, so `next.ctx` is always
        // `params.ctx` — the one still missing this boss's `contextDefaults`
        // for whichever fields nobody explicitly set. See `effectiveCtx`.
        ctx: effectiveCtx,
        seed: next.seed,
        n: next.kills,
        tables: tablesQuery.data,
        prices,
      })
    },
    [bossQuery.data, tablesQuery.data, pricesQuery.data, effectiveCtx, run]
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
    setSearchParams(searchFromParams(effective, bossQuery.data?.contextDefaults), { replace: true })
    runWith(effective)
  }

  useEffect(() => {
    if (autoRan.current || !params.run) return
    if (bossQuery.data === undefined || tablesQuery.data === undefined) return

    // Shared links are the only path that intentionally waits: they need to
    // replay the exact run the owner shared, not a stale unpriced fallback.
    // The query must be settled before we dispatch, otherwise a shared link can
    // fire against an empty map and then lock in that stale answer forever.
    if (pricesQuery.isLoading || !pricesQuery.isFetched) return

    autoRan.current = true
    const prices = pricesQuery.data ?? new Map<number, number>()
    ranWithPricesRef.current = prices.size > 0

    // Every link this app produces carries a real seed, so the sentinel branch
    // is only reachable on a hand-edited `?run=1&seed=0`. Rolling is the right
    // reading of that link — "run one" — rather than seeding the RNG with 0.
    const effective = params.seed === RANDOM_SEED ? { ...params, seed: rollSeed() } : params
    runWith(effective)
  }, [params, bossQuery.data, tablesQuery.data, pricesQuery.data, pricesQuery.isFetched, pricesQuery.isLoading, runWith])

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
            pricesAvailable={ranWithPricesRef.current}
          />
        )}
      </section>
    </div>
  )
}
