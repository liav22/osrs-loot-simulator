import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSiteIndex } from '../hooks/useSiteIndex'
import { fuzzySearch } from '../lib/fuzzy'
import { pickSuggestedBosses } from '../lib/suggestions'
import { StatusBadge } from './StatusBadge'
import { BossThumb } from './BossThumb'

/** Five is enough to contain the answer and short enough to read without scanning. */
const MAX_RESULTS = 5

/** Four fits one row without pushing the page past 1080p, and is enough to give a first-time visitor somewhere to click. */
const SUGGESTION_COUNT = 4

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
    // A boss fought once during a quest and never again (Bouncer, Sigmund,
    // "Me") has nothing for a kill simulator to say, and it crowds out the
    // bosses people actually farm — see docs/DECISIONS.md. Excluded from
    // search, not deleted: the document, and the flag itself, stay visible
    // on /admin, which is the audit trail for exactly this kind of call.
    const repeatable = data.entries.filter((entry) => entry.repeatable)
    return fuzzySearch(repeatable, query).slice(0, MAX_RESULTS)
  }, [data, query])

  // Reshuffled once per page load (`data`'s identity is stable across
  // re-renders within a session — react-query caches the site index
  // forever, see `useSiteIndex`), not on every keystroke.
  const suggestions = useMemo(
    () => (data === undefined ? [] : pickSuggestedBosses(data.entries, SUGGESTION_COUNT)),
    [data]
  )

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
        className="w-full rounded-md border border-neutral-800 bg-neutral-900 px-4 py-3 text-sm text-neutral-100 placeholder:text-muted focus:border-amber-500/60 focus:outline-none focus:ring-1 focus:ring-amber-500/60"
      />

      {isLoading && <p className="mt-2 text-sm text-muted">Loading boss index…</p>}
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
                <span className="truncate">
                  {entry.name}
                  {/* A many-to-one source's own literal page name (e.g. "Ancient
                      chest") is what it's findable under by MATCHING an alias,
                      but on its own gives no sign this is Chambers of Xeric's
                      loot — spell out the alias(es) so the result is legible on
                      sight, not just searchable. */}
                  {entry.aliases.length > 0 && (
                    <span className="text-muted"> ({entry.aliases.join(', ')})</span>
                  )}
                </span>
                <StatusBadge status={entry.status} statusTier={entry.statusTier} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {data !== undefined && query.trim() !== '' && results.length === 0 && (
        <p className="mt-2 text-sm text-muted">No bosses match "{query}".</p>
      )}

      {/* Somewhere to click for a first-time visitor — gone as soon as they
          type, so it never competes with real results. */}
      {query.trim() === '' && suggestions.length > 0 && (
        <div className="mt-4 grid grid-cols-4 gap-2">
          {suggestions.map((entry) => (
            <button
              key={entry.slug}
              type="button"
              onClick={() => select(entry.slug)}
              className="flex flex-col items-center gap-1.5 rounded-md p-2 text-center hover:bg-neutral-900"
            >
              <BossThumb name={entry.name} image={entry.image} />
              <span className="w-full truncate text-xs text-neutral-300">{entry.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
