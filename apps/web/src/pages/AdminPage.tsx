import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import type { BossStatus } from '@osrs-loot-simulator/loot-model'
import { useSiteIndex } from '../hooks/useSiteIndex'
import { useBoss } from '../hooks/useBoss'
import { StatusBadge } from '../components/StatusBadge'

const FILTERS: Array<BossStatus | 'all'> = ['all', 'needs_review', 'verified', 'manual_override']

/** PROJECT_PLAN.md 7: "Build a minimal admin page... that lists failures with the reason." */
export function AdminPage() {
  const { data, isLoading, isError } = useSiteIndex()
  const [searchParams] = useSearchParams()
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>(
    (searchParams.get('status') as (typeof FILTERS)[number]) ?? 'all'
  )
  const [expanded, setExpanded] = useState<string | null>(searchParams.get('slug'))

  const entries = useMemo(() => {
    if (data === undefined) return []
    return data.entries.filter((e) => filter === 'all' || e.status === filter)
  }, [data, filter])

  const counts = useMemo(() => {
    const c = { verified: 0, needs_review: 0, manual_override: 0 }
    for (const e of data?.entries ?? []) c[e.status] += 1
    return c
  }, [data])

  if (isLoading) return <p className="p-8 text-sm text-muted">Loading…</p>
  if (isError || data === undefined) return <p className="p-8 text-sm text-red-400">Failed to load the boss index.</p>

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="mb-1 text-lg font-semibold text-neutral-100">Validation report</h1>
      <p className="mb-4 text-sm text-muted">
        Generated {new Date(data.generatedAt).toLocaleString()} · {data.entries.length} sources ·{' '}
        {counts.verified} verified, {counts.needs_review} needs review, {counts.manual_override} manual override
      </p>

      <div className="mb-4 flex gap-2">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium ${
              filter === f ? 'bg-amber-500 text-neutral-950' : 'bg-neutral-900 text-neutral-400 hover:bg-neutral-800'
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      <div className="divide-y divide-neutral-900 overflow-hidden rounded-md border border-neutral-800">
        {entries.map((entry) => (
          <AdminRow
            key={entry.slug}
            slug={entry.slug}
            name={entry.name}
            status={entry.status}
            open={expanded === entry.slug}
            onToggle={() => setExpanded((current) => (current === entry.slug ? null : entry.slug))}
          />
        ))}
        {entries.length === 0 && <p className="px-4 py-6 text-center text-sm text-muted">No sources match this filter.</p>}
      </div>
    </div>
  )
}

function AdminRow({
  slug,
  name,
  status,
  open,
  onToggle,
}: {
  slug: string
  name: string
  status: BossStatus
  open: boolean
  onToggle: () => void
}) {
  const bossQuery = useBoss(open ? slug : undefined)

  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 bg-neutral-950 px-4 py-2.5 text-left text-sm hover:bg-neutral-900"
      >
        <span className="flex items-center gap-2">
          <span className="text-muted">{open ? '▾' : '▸'}</span>
          {name}
        </span>
        <StatusBadge status={status} />
      </button>
      {open && (
        <div className="border-t border-neutral-900 bg-neutral-900/40 px-4 py-3 text-xs">
          {bossQuery.isLoading && <p className="text-muted">Loading checks…</p>}
          {bossQuery.data !== undefined && (
            <ul className="space-y-1">
              {bossQuery.data.validation.checks.map((check) => (
                <li key={check.check} className="flex gap-2">
                  <span className={check.ok ? 'text-emerald-400' : 'text-red-400'}>{check.ok ? '✓' : '✗'}</span>
                  <span className="text-neutral-400">{check.check}</span>
                  {check.detail !== undefined && <span className="text-muted">— {check.detail}</span>}
                </li>
              ))}
            </ul>
          )}
          {/* `Link`, not a root-absolute href — see the note in BossView.tsx: on
              GitHub Pages this app lives under /osrs-loot-simulator/. */}
          <Link to={`/boss/${slug}`} className="mt-2 inline-block text-amber-400 hover:underline">
            View boss →
          </Link>
        </div>
      )}
    </div>
  )
}
