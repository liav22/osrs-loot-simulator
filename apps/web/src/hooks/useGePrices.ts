import { useQuery } from '@tanstack/react-query'
import { fetchGePrices } from '../lib/prices'

/** Refetched every 5 minutes — GE prices move; a stale cache silently under/overstates gp/kill. */
export function useGePrices() {
  return useQuery({ queryKey: ['ge-prices'], queryFn: fetchGePrices, staleTime: 5 * 60 * 1000 })
}
