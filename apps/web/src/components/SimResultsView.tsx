import { useMemo, useState } from 'react'
import type { Boss, ExpectedValueResult, SimResult } from '@osrs-loot-simulator/loot-model'
import { formatCompact, formatGp, formatNumber } from '../lib/format'
import { uniqueItemKeys } from '../lib/uniques'
import { useItemIcons } from '../hooks/useItemIcons'
import { ItemIcon } from './ItemIcon'

/** Enough to fill a 1080p results column; the rest is one click away. */
const COLLAPSED_COUNT = 24

interface Props {
  boss: Boss
  result: SimResult
  expected: ExpectedValueResult | undefined
  /**
   * Whether THIS run was priced. Not inferrable from the result: a run with no
   * prices reports gp 0 for everything, which is indistinguishable from a boss
   * that genuinely drops nothing tradeable. `BossView` records it at dispatch
   * rather than reading the live query, because Simulate no longer waits for
   * the GE fetch and the two can disagree.
   */
  pricesAvailable: boolean
}

export function SimResultsView({ boss, result, expected, pricesAvailable }: Props) {
  const [expandedGrid, setExpandedGrid] = useState(false)
  const [showLog, setShowLog] = useState(false)

  const uniques = useMemo(() => uniqueItemKeys(boss), [boss])
  // One query for the whole view rather than one per card: the icon file names
  // are a single ~30KB document, and threading the lookup down beats sixty
  // components each subscribing to the same cache entry.
  const { data: iconFiles } = useItemIcons()
  const rarityByKey = useMemo(
    () => new Map((expected?.items ?? []).map((item) => [item.itemKey, item.expectedDrops])),
    [expected]
  )

  /**
   * Value descending is the default because it puts the interesting drops at
   * the top without anything needing to know they are interesting — a visage
   * sorts above rune arrows on price alone.
   *
   * When prices are unavailable that ordering collapses to "everything is 0",
   * which looks arbitrary rather than broken. Rarity is always present in the
   * data and price is not, so the fallback is rarity ascending (rarest first)
   * and the header says which one is in force.
   */
  const rows = useMemo(() => {
    /*
     * `result.drops` is a tally over every item the compiled tables COULD
     * produce, so it carries zero-count entries for everything that did not
     * drop. The old table rendered those too, which was survivable in a
     * spreadsheet of rates but is not here: a card grid of "Draconic visage
     * ×0" states the opposite of what a grid of drops means, and it would put
     * never-dropped items in the uniques strip, which is the one place the
     * page is claiming something happened.
     */
    const sorted = result.drops.filter((row) => row.drops > 0)
    if (pricesAvailable) {
      sorted.sort((a, b) => b.gp - a.gp || b.quantity - a.quantity || a.name.localeCompare(b.name))
    } else {
      sorted.sort((a, b) => {
        // Absent from the EV result (an unsupported source) sorts last rather
        // than to the front, where a missing value would masquerade as rarity.
        const ea = rarityByKey.get(a.itemKey) ?? Infinity
        const eb = rarityByKey.get(b.itemKey) ?? Infinity
        return ea - eb || a.name.localeCompare(b.name)
      })
    }
    return sorted
  }, [result.drops, pricesAvailable, rarityByKey])

  const hasMoreRows = rows.length > COLLAPSED_COUNT
  const visible = expandedGrid ? rows : rows.slice(0, COLLAPSED_COUNT)
  const strip = rows.filter((row) => uniques.has(row.itemKey))

  return (
    <div className="flex min-h-0 flex-col gap-3">
      {/* `data-testid`, not a text match: the e2e suite has to wait for a run
          to FINISH, and the results section itself is on screen the whole time
          showing an empty state. Waiting on a heading that never leaves would
          pass before the worker had replied. */}
      <div
        data-testid="results-summary"
        className="flex shrink-0 flex-wrap items-baseline gap-x-4 gap-y-1 text-sm"
      >
        <span className="text-neutral-300">
          <span className="font-mono text-neutral-100">{formatNumber(result.kills)}</span> kills
        </span>
        <span className="text-neutral-300">
          <span className="font-mono text-neutral-100">{formatGp(result.gpTotal)}</span> total
        </span>
        <span className="text-neutral-300">
          <span className="font-mono text-neutral-100">{formatGp(result.gpPerKill)}</span> / kill
        </span>
        <span className="text-xs text-muted">seed {result.seed}</span>
      </div>

      {/* Absent entirely when nothing qualified — an empty "no rare drops"
          state reads as a failed run rather than an ordinary one. */}
      {strip.length > 0 && (
        <div className="shrink-0 rounded-md border border-amber-500/30 bg-amber-500/5 p-2">
          <div className="mb-1.5 px-1 text-xs font-medium uppercase tracking-wide text-amber-400/80">
            Uniques
          </div>
          <div className="flex flex-wrap gap-1.5">
            {strip.map((row) => (
              <div
                key={row.itemKey}
                className="flex items-center gap-2 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1.5"
              >
                <ItemIcon name={row.name} file={iconFiles?.get(row.name)} size={24} />
                <span className="text-sm text-amber-100">{row.name}</span>
                <span
                  className="font-mono text-xs text-amber-300/80"
                  title={
                    row.quantity !== row.drops
                      ? `${formatNumber(row.quantity)} (${formatNumber(row.drops)} drops)`
                      : formatNumber(row.quantity)
                  }
                >
                  ×{formatCompact(row.quantity)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex shrink-0 items-center justify-between gap-3 text-xs text-muted">
        <span>
          {rows.length} distinct {rows.length === 1 ? 'item' : 'items'} · sorted by{' '}
          {pricesAvailable ? 'total value' : 'rarity (prices unavailable)'}
        </span>
        {hasMoreRows && (
          <button
            type="button"
            onClick={() => setExpandedGrid((v) => !v)}
            className="shrink-0 text-amber-400 hover:underline"
          >
            {expandedGrid ? 'Show fewer' : `Show all ${rows.length}`}
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {rows.length === 0 ? (
          <p className="rounded-md border border-neutral-800 px-3 py-6 text-center text-sm text-muted">
            No drops in this run.
          </p>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(190px,1fr))] gap-2">
            {visible.map((row) => {
              const isUnique = uniques.has(row.itemKey)
              return (
                <div
                  key={row.itemKey}
                  data-item-card=""
                  // Border AND background, never colour alone — the highlight
                  // has to survive being the only signal someone can see.
                  className={`flex items-center gap-2 rounded-md border px-2.5 py-2 ${
                    isUnique
                      ? 'border-amber-500/50 bg-amber-500/10'
                      : 'border-neutral-800 bg-neutral-900/60'
                  }`}
                >
                  <ItemIcon name={row.name} file={iconFiles?.get(row.name)} size={32} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-neutral-100" title={row.name}>
                      {row.name}
                    </div>
                    {/* The unique card's amber tint LIFTS its background, so
                        the muted colour that clears AA everywhere else does
                        not clear it here (4.19:1). One step lighter restores
                        it (7.33:1). This is the one place the muted token has
                        to be overridden, and it is because the surface moved,
                        not because the token is wrong. */}
                    <div
                      className={`flex items-baseline justify-between gap-2 font-mono text-xs ${
                        isUnique ? 'text-neutral-300' : 'text-muted'
                      }`}
                    >
                      {/* K/M/B-suffixed so a stack in the hundreds of
                          thousands doesn't push the gp value off the card.
                          The precise count — and the occurrence count for
                          stackable items, which drop fewer TIMES than the
                          total units received (e.g. "50 Gold bars") — is a
                          hover title instead of fields that don't fit. */}
                      <span
                        className="truncate"
                        title={
                          row.quantity !== row.drops
                            ? `${formatNumber(row.quantity)} (${formatNumber(row.drops)} drops)`
                            : formatNumber(row.quantity)
                        }
                      >
                        ×{formatCompact(row.quantity)}
                      </span>
                      {pricesAvailable && row.gp > 0 && (
                        <span className="shrink-0 truncate">{formatGp(row.gp)}</span>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {result.log.length > 0 && (
        <div className="shrink-0">
          <button
            type="button"
            onClick={() => setShowLog((v) => !v)}
            className="text-xs text-muted hover:text-amber-400 hover:underline"
          >
            {showLog ? 'Hide' : 'Show'} per-kill log (first {formatNumber(result.log.length)} kills)
          </button>
          {showLog && (
            <div className="mt-2 max-h-48 overflow-y-auto rounded-md border border-neutral-800">
              <table className="w-full text-xs">
                <tbody className="divide-y divide-neutral-900">
                  {result.log.map((entry) => (
                    <tr key={entry.kill}>
                      <td className="w-16 px-3 py-1 text-muted">#{entry.kill}</td>
                      <td className="px-3 py-1">
                        {entry.drops.length === 0 ? (
                          <span className="text-muted">nothing</span>
                        ) : (
                          entry.drops.map((d) => `${d.name}${d.qty !== 1 ? ` ×${d.qty}` : ''}`).join(', ')
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
