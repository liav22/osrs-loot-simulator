import type { SiteIndexEntry } from './types'

/**
 * Dependency-free fuzzy match: a case-insensitive substring on the name or
 * an alias scores highest (0), an in-order subsequence match scores by how
 * spread out it is (higher = worse), anything else doesn't match (null).
 * PROJECT_PLAN.md 9: "Fuzzy-search that index client-side. No search API
 * needed" — the whole index is a few hundred entries, so this runs on every
 * keystroke with no debouncing needed.
 */
function matchScore(haystack: string, needle: string): number | null {
  const h = haystack.toLowerCase()
  const n = needle.toLowerCase()
  if (n === '') return 0
  const idx = h.indexOf(n)
  if (idx !== -1) return idx // earlier substring match ranks better

  let hi = 0
  let matched = 0
  let spread = 0
  let firstMatch = -1
  for (let ni = 0; ni < n.length && hi < h.length; ) {
    if (h[hi] === n[ni]) {
      if (firstMatch === -1) firstMatch = hi
      matched++
      ni++
    }
    hi++
  }
  if (matched !== n.length) return null
  spread = hi - firstMatch
  return 1000 + spread
}

export interface SearchResult {
  entry: SiteIndexEntry
  score: number
}

export function fuzzySearch(entries: readonly SiteIndexEntry[], query: string): SearchResult[] {
  const trimmed = query.trim()
  if (trimmed === '') {
    return entries.map((entry) => ({ entry, score: 0 }))
  }
  const results: SearchResult[] = []
  for (const entry of entries) {
    const candidates = [entry.name, ...entry.aliases]
    let best: number | null = null
    for (const candidate of candidates) {
      const score = matchScore(candidate, trimmed)
      if (score !== null && (best === null || score < best)) best = score
    }
    if (best !== null) results.push({ entry, score: best })
  }
  return results.sort((a, b) => a.score - b.score || a.entry.name.localeCompare(b.entry.name))
}
