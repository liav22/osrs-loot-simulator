import { useQuery } from '@tanstack/react-query'
import { fetchBoss, fetchSharedTables } from '../lib/api'
import { useSiteIndex } from './useSiteIndex'

/** Lazy-fetched on selection, cached by slug — PROJECT_PLAN.md 9. */
export function useBoss(slug: string | undefined) {
  return useQuery({
    queryKey: ['boss', slug],
    queryFn: () => fetchBoss(slug!),
    enabled: slug !== undefined,
  })
}

/**
 * Every `data/tables/` record — small, fetched once, reused across every boss.
 *
 * Chained off the site index rather than a literal id list here, because the
 * index carries the generated manifest of what that directory actually holds.
 * See `fetchSharedTables` for the production bug the literal caused. The
 * `useSiteIndex()` call shares TanStack Query's `['site-index']` entry with
 * every other caller, so this adds a dependency, not a second fetch.
 */
export function useSharedTables() {
  const index = useSiteIndex()
  const ids = index.data?.tables
  return useQuery({
    queryKey: ['shared-tables', ids],
    queryFn: () => fetchSharedTables(ids ?? []),
    enabled: ids !== undefined,
    staleTime: Infinity,
  })
}
