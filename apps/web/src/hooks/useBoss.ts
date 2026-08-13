import { useQuery } from '@tanstack/react-query'
import { fetchBoss, fetchSharedTables } from '../lib/api'

/** Lazy-fetched on selection, cached by slug — PROJECT_PLAN.md 9. */
export function useBoss(slug: string | undefined) {
  return useQuery({
    queryKey: ['boss', slug],
    queryFn: () => fetchBoss(slug!),
    enabled: slug !== undefined,
  })
}

/** The three shared RDT/gem/mega-rare tables — small, fetched once, reused across every boss. */
export function useSharedTables() {
  return useQuery({ queryKey: ['shared-tables'], queryFn: fetchSharedTables, staleTime: Infinity })
}
