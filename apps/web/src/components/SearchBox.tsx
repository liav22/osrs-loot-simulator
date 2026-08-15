import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSiteIndex } from '../hooks/useSiteIndex'
import { fuzzySearch } from '../lib/fuzzy'
import { StatusBadge } from './StatusBadge'

/** Five is enough to contain the answer and short enough to read without scanning. */
const MAX_RESULTS = 5

/**
 * Boss search. The list is hidden until something is typed — an always-visible
 * list of 52 entries was most of the page's height and none of its purpose.
 *
 * `fuzzySearch` is reused as-is (it has its own tests) with one wrinkle worth
 * naming: it returns EVERY entry for an empty query, by design, and that is
 * still the right behaviour for a pure function. The "empty query means empty
 * list" rule belongs here, at the call site, not inside the matcher.
 */
export function SearchBox({ autoFocus = true }: { autoFocus?: boolean }) {
  const { data, isLoading, isError } = useSiteIndex()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const navigate = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus()
  }, [autoFocus])

  const results = useMemo(() => {
    if (data === undefined || query.trim() === '') return []
    return fuzzySearch(data.entries, query).slice(0, MAX_RESULTS)
  }, [data, query])

  // A shorter result list must not leave the highlight pointing past its end.
  useEffect(() => setActive(0), [query])

  function select(slug: string) {
    navigate(`/boss/${slug}`)
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      setQuery('')
      return
    }
    if (results.length === 0) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((i) => (i + 1) % results.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((i) => (i - 1 + results.length) % results.length)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const chosen = results[active] ?? results[0]
      if (chosen !== undefined) select(chosen.entry.slug)
    }
  }

  const listboxId = 'boss-search-results'

  return (
    <div className="relative w-full">
      <label htmlFor="boss-search" className="sr-only">
        Search bosses
      </label>
      <input
        id="boss-search"
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={results.length > 0}
        aria-controls={listboxId}
        aria-autocomplete="list"
        autoComplete="off"
        spellCheck={false}
        placeholder="Search a boss… (e.g. giant mole)"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={onKeyDown}
        className="w-full rounded-md border border-neutral-800 bg-neutral-900 px-4 py-3 text-sm text-neutral-100 placeholder:text-neutral-500 focus:border-amber-500/60 focus:outline-none focus:ring-1 focus:ring-amber-500/60"
      />

      {isLoading && <p className="mt-2 text-sm text-neutral-500">Loading boss index…</p>}
      {isError && <p className="mt-2 text-sm text-red-400">Failed to load the boss index.</p>}

      {results.length > 0 && (
        <ul
          id={listboxId}
          role="listbox"
          className="absolute z-20 mt-2 w-full divide-y divide-neutral-800 overflow-hidden rounded-md border border-neutral-800 bg-neutral-900 shadow-xl shadow-neutral-950/60"
        >
          {results.map(({ entry }, i) => (
            <li key={entry.slug} role="option" aria-selected={i === active}>
              <button
                type="button"
                onClick={() => select(entry.slug)}
                onMouseEnter={() => setActive(i)}
                className={`flex min-h-11 w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm ${
                  i === active ? 'bg-neutral-800' : 'hover:bg-neutral-800'
                }`}
              >
                <span className="truncate">{entry.name}</span>
                <StatusBadge status={entry.status} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {data !== undefined && query.trim() !== '' && results.length === 0 && (
        <p className="mt-2 text-sm text-neutral-500">No bosses match "{query}".</p>
      )}
    </div>
  )
}
