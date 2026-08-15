import { lazy, Suspense } from 'react'
import { Link, Route, Routes, useLocation } from 'react-router-dom'
import { HomePage } from './pages/HomePage'
import { Footer } from './components/Footer'

/**
 * The admin page is a maintenance tool — a validation report over the parsed
 * corpus — and it does not ship to production.
 *
 * `import.meta.env.DEV` is replaced with a literal `false` at build time, so
 * this whole expression folds to `null` and the `import()` inside the dead arm
 * is never emitted as a chunk.
 *
 * **The condition has to wrap the `lazy()` call, not just the route.** The
 * first attempt put `lazy(async () => import(...))` at module scope and guarded
 * only the `<Route>`: the route died, but the `lazy()` call did not, so the
 * dynamic import was still reachable and Rollup emitted the chunk anyway. The
 * production bundle still contained the entire admin page. `e2e/pages-deploy.
 * spec.ts` greps the built assets off disk, which is what caught it — a check
 * that only looked at routes, or at what the browser loaded, would have passed.
 */
const AdminPage = import.meta.env.DEV
  ? lazy(async () => ({ default: (await import('./pages/AdminPage')).AdminPage }))
  : null

/**
 * Fixed-height app shell.
 *
 * `100dvh`, never `100vh`: on mobile browsers with a collapsing toolbar `vh`
 * is the *largest* viewport height, so a `100vh` shell is taller than what is
 * actually visible and the primary action sits under the URL bar.
 *
 * The shell is only fixed-height from 900px up, which is the width where the
 * two-column layout appears. Below that the columns stack and the page is
 * allowed to scroll — forcing everything into one viewport on a phone is how
 * you get a 60px-tall results panel.
 */
export function App() {
  const { pathname } = useLocation()
  const onAdmin = pathname.endsWith('/admin')
  const onBoss = pathname.includes('/boss/')

  return (
    <div className="flex min-h-[100dvh] flex-col min-[900px]:h-[100dvh] min-[900px]:overflow-hidden">
      {/* `bg-neutral-900` lifts the chrome off the `neutral-950` body so the
          header reads as a frame rather than as part of the content, and it is
          the background every contrast figure for this bar is computed
          against (muted text on it is 6.91:1). */}
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-neutral-800 bg-neutral-900 px-4 py-2">
        <Link to="/" className="text-sm font-semibold text-neutral-100 hover:text-amber-400">
          OSRS Loot Simulator
        </Link>
        <div className="flex items-center gap-3 text-xs text-muted">
          <span className="hidden sm:inline">
            data from the{' '}
            <a
              href="https://oldschool.runescape.wiki/"
              target="_blank"
              rel="noreferrer"
              className="hover:text-neutral-100 hover:underline"
            >
              OSRS Wiki
            </a>
          </span>
          {import.meta.env.DEV && !onAdmin && (
            <Link to="/admin" className="hover:text-neutral-100 hover:underline">
              admin
            </Link>
          )}
          <a
            href="https://github.com/liav22/osrs-loot-simulator"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Source code on GitHub (opens in a new tab)"
            className="-mr-1 flex h-8 w-8 items-center justify-center rounded-md hover:bg-neutral-800 hover:text-neutral-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber-500/60"
          >
            {/* Decorative: the accessible name comes from the anchor's
                aria-label, so exposing the SVG too would announce it twice. */}
            <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false" className="h-4 w-4 fill-current">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
            </svg>
          </a>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/boss/:slug" element={<HomePage />} />
          {AdminPage !== null && (
            <Route
              path="/admin"
              element={
                <Suspense fallback={<p className="p-4 text-sm text-muted">Loading admin…</p>}>
                  <AdminPage />
                </Suspense>
              }
            />
          )}
          {/* In production `/admin` has no route, so it falls through to this
              catch-all and renders search — a dead link, not a broken page. */}
          <Route path="*" element={<HomePage />} />
        </Routes>
      </main>

      <Footer reserveActionBar={onBoss} />
    </div>
  )
}
