import { useState } from 'react'
import type { ExpectedValueResult, SimResult } from '@osrs-loot-simulator/loot-model'
import { formatGp, formatNumber, formatPercent } from '../lib/format'

interface Props {
  result: SimResult
  expected: ExpectedValueResult | undefined
}

export function SimResultsView({ result, expected }: Props) {
  const [showLog, setShowLog] = useState(false)
  const expectedByKey = new Map((expected?.items ?? []).map((item) => [item.itemKey, item]))
  const rows = [...result.drops].sort((a, b) => b.gp - a.gp || b.drops - a.drops)

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Kills" value={formatNumber(result.kills)} />
        <Stat label="Seed" value={String(result.seed)} />
        <Stat label="GP / kill" value={formatGp(result.gpPerKill)} />
        <Stat label="Total GP" value={formatGp(result.gpTotal)} />
      </div>

      <div className="overflow-hidden rounded-md border border-neutral-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-800 bg-neutral-900 text-left text-xs text-neutral-500">
              <th className="px-3 py-2 font-medium">Item</th>
              <th className="px-3 py-2 text-right font-medium">Drops</th>
              <th className="px-3 py-2 text-right font-medium">Observed rate</th>
              <th className="px-3 py-2 text-right font-medium">Theoretical rate</th>
              <th className="px-3 py-2 text-right font-medium">Quantity</th>
              <th className="px-3 py-2 text-right font-medium">GP</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-900">
            {rows.map((row) => {
              const theoretical = expectedByKey.get(row.itemKey)
              return (
                <tr key={row.itemKey} className="hover:bg-neutral-900/60">
                  <td className="px-3 py-1.5">{row.name}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-xs">{formatNumber(row.drops)}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-xs text-neutral-400">
                    {formatPercent(row.drops / result.kills)}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-xs text-neutral-500">
                    {theoretical !== undefined ? formatPercent(theoretical.expectedDrops) : '—'}
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono text-xs">{formatNumber(row.quantity)}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-xs">{formatGp(row.gp)}</td>
                </tr>
              )
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-center text-neutral-500">
                  No drops in this run.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {result.log.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowLog((v) => !v)}
            className="text-sm text-amber-400 hover:underline"
          >
            {showLog ? 'Hide' : 'Show'} per-kill log (first {formatNumber(result.log.length)} kills)
          </button>
          {showLog && (
            <div className="mt-2 max-h-96 overflow-y-auto rounded-md border border-neutral-800">
              <table className="w-full text-xs">
                <tbody className="divide-y divide-neutral-900">
                  {result.log.map((entry) => (
                    <tr key={entry.kill}>
                      <td className="w-16 px-3 py-1 text-neutral-500">#{entry.kill}</td>
                      <td className="px-3 py-1">
                        {entry.drops.length === 0 ? (
                          <span className="text-neutral-600">nothing</span>
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className="font-mono text-sm text-neutral-100">{value}</div>
    </div>
  )
}
