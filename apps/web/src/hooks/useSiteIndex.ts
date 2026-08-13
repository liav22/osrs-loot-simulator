import { useQuery } from '@tanstack/react-query'
import { fetchSiteIndex } from '../lib/api'

export function useSiteIndex() {
  return useQuery({ queryKey: ['site-index'], queryFn: fetchSiteIndex })
}
