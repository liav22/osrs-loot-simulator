import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSiteIndex } from '../hooks/useSiteIndex'
import { fuzzySearch } from '../lib/fuzzy'
import { StatusBadge } from './StatusBadge'

export function SearchBox() {
  const { data, isLoading, isError } = useSiteIndex()
  const [query, setQuery] = useState('')
  const navigate = useNavigate()

  const results = useMemo(() => {
    if (data === undefined) return []
    return fuzzySearch(data.entries, query).slice(0, 25)
  }, [data, query])

  return (
    <div className="w-full max-w-xl">
      <label htmlFor="boss-search" className="sr-only">
        Search bosses
      </label>
      <input
        id="boss-search"
        type="text"
        autoComplete="off"
        spellCheck={false}
        placeholder="Search a boss… (e.g. giant mole)"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        className="w-full rounded-md border border-neutral-800 bg-neutral-900 px-4 py-2.5 text-sm text-neutral-100 placeholder:text-neutral-500 focus:border-amber-500/60 focus:outline-none focus:ring-1 focus:ring-amber-500/60"
      />

      {isLoading && <p className="mt-2 text-sm text-neutral-500">Loading boss index…</p>}
      {isError && <p className="mt-2 text-sm text-red-400">Failed to load the boss index.</p>}

      {data !== undefined && (
        <ul className="mt-2 divide-y divide-neutral-800 overflow-hidden rounded-md border border-neutral-800 bg-neutral-900">
          {results.length === 0 && (
            <li className="px-4 py-3 text-sm text-neutral-500">No bosses match "{query}".</li>
          )}
          {results.map(({ entry }) => (
            <li key={entry.slug}>
              <button
                type="button"
                onClick={() => navigate(`/boss/${entry.slug}`)}
                className="flex w-full items-center justify-between px-4 py-2.5 text-left text-sm hover:bg-neutral-800"
              >
                <span>{entry.name}</span>
                <StatusBadge status={entry.status} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
