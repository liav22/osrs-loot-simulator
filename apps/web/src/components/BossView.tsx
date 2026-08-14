import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { expectedValue, type ExpectedValueResult } from '@osrs-loot-simulator/loot-model'
import { useBoss, useSharedTables } from '../hooks/useBoss'
import { useSimulationWorker } from '../hooks/useSimulationWorker'
import { useGePrices } from '../hooks/useGePrices'
import { gePriceLookup } from '../lib/prices'
import { paramsFromSearch, searchFromParams, type SimRunParams } from '../lib/url-state'
import { StatusBadge } from './StatusBadge'
import { DropTableView } from './DropTableView'
import { SimContextControls } from './SimContextControls'
import { SimResultsView } from './SimResultsView'

export function BossView({ slug }: { slug: string }) {
  const bossQuery = useBoss(slug)
  const tablesQuery = useSharedTables()
  const pricesQuery = useGePrices()
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

  function handleSimulate() {
    if (bossQuery.data === undefined || tablesQuery.data === undefined) return
    run({
      boss: bossQuery.data,
      ctx: params.ctx,
      seed: params.seed,
      n: params.kills,
      tables: tablesQuery.data,
      prices: pricesQuery.data ?? new Map(),
    })
  }

  if (bossQuery.isLoading) return <p className="text-sm text-neutral-500">Loading {slug}…</p>
  if (bossQuery.isError) {
    return <p className="text-sm text-red-400">Could not load "{slug}": {(bossQuery.error as Error).message}</p>
  }
  if (bossQuery.data === undefined) return null
  const boss = bossQuery.data

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold text-neutral-100">{boss.name}</h1>
        <StatusBadge status={boss.status} />
        <a
          href={`https://oldschool.runescape.wiki/w/${encodeURIComponent(boss.wikiPage.replace(/ /g, '_'))}`}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-neutral-500 hover:text-amber-400 hover:underline"
        >
          OSRS Wiki ↗
        </a>
      </div>

      {boss.status !== 'verified' && (
        <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">
          This source hasn't cleared every deterministic check yet — rates below may be incomplete or wrong. See
          the <a href={`/admin?slug=${boss.slug}`} className="underline">admin page</a> for specifics.
        </p>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-6">
          <section>
            <h2 className="mb-2 text-sm font-semibold text-neutral-300">Drop tables</h2>
            <DropTableView tables={boss.tables} />
          </section>

          {simState.status === 'error' && (
            <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              Simulation failed: {simState.message}
            </p>
          )}
          {simState.status === 'running' && <p className="text-sm text-neutral-500">Simulating…</p>}
          {simState.status === 'done' && (
            <section>
              <h2 className="mb-2 text-sm font-semibold text-neutral-300">Results</h2>
              <SimResultsView result={simState.result} expected={expected} />
            </section>
          )}
        </div>

        <aside>
          {tablesQuery.isLoading && <p className="text-sm text-neutral-500">Loading shared tables…</p>}
          {tablesQuery.data !== undefined && (
            <SimContextControls
              boss={boss}
              // Needed to discover ownership-gated controls: Lunar Chest's
              // per-set duplicate protection lives in its referenced shared
              // tables, not in the boss document.
              sharedTables={tablesQuery.data}
              params={params}
              onChange={updateParams}
              onSimulate={handleSimulate}
              // Waiting on prices too, not just tables: clicking Simulate
              // before the GE price fetch resolves would silently run with
              // an empty price map and show 0 gp everywhere, which reads as
              // a bug rather than "still loading."
              buttonState={simState.status === 'running' ? 'running' : pricesQuery.isLoading ? 'loading-prices' : 'idle'}
            />
          )}
        </aside>
      </div>
    </div>
  )
}
