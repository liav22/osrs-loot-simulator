import { useParams } from 'react-router-dom'
import { SearchBox } from '../components/SearchBox'
import { BossView } from '../components/BossView'

/** PROJECT_PLAN.md 9: "/" is search + boss view + simulator; "/boss/:slug" is the same, deep-linkable. */
export function HomePage() {
  const { slug } = useParams<{ slug?: string }>()

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-8 flex flex-col items-start gap-4">
        <div>
          <h1 className="text-lg font-semibold text-neutral-100">OSRS Loot Simulator</h1>
          <p className="text-sm text-neutral-500">Search a boss, inspect its drop table, simulate kills.</p>
        </div>
        <SearchBox />
      </div>

      {slug !== undefined && <BossView key={slug} slug={slug} />}
    </div>
  )
}
