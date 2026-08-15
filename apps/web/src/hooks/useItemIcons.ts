import { useQuery } from '@tanstack/react-query'
import { fetchItemIcons } from '../lib/api'

/**
 * The resolved icon file name for every corpus item.
 *
 * `staleTime: Infinity` — this file changes only when `ingest item-icons` is
 * re-run and the result committed, so re-fetching it during a session can
 * never return anything new.
 */
export function useItemIcons() {
  return useQuery({ queryKey: ['item-icons'], queryFn: fetchItemIcons, staleTime: Infinity })
}
