import { useParams } from 'react-router-dom'
import { SearchBox } from '../components/SearchBox'
import { BossView } from '../components/BossView'

/**
 * PROJECT_PLAN.md 9: "/" is search + boss view + simulator; "/boss/:slug" is
 * the same, deep-linkable.
 *
 * Search and the boss panel are alternatives rather than stacked: selecting a
 * boss replaces the search UI, and BossPanel's "← change boss" link comes back
 * here. Keeping both on screen was most of what made the old page tall.
 */
export function HomePage() {
  const { slug } = useParams<{ slug?: string }>()

  if (slug !== undefined) return <BossView key={slug} slug={slug} />

  return (
    <div className="flex flex-1 items-start justify-center px-4 pt-[12vh]">
      <div className="w-full max-w-xl">
        <h1 className="mb-1 text-2xl font-semibold text-neutral-100">Simulate a boss's drops</h1>
        <p className="mb-4 text-sm text-neutral-500">
          Search a boss, pick a kill count, and see what the table actually gives you.
        </p>
        <SearchBox />
      </div>
    </div>
  )
}
