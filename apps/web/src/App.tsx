import { Link, Route, Routes, useLocation } from 'react-router-dom'
import { HomePage } from './pages/HomePage'
import { AdminPage } from './pages/AdminPage'
import { Footer } from './components/Footer'

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
      <header className="flex shrink-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-neutral-800 px-4 py-2">
        <Link to="/" className="text-sm font-semibold text-neutral-100 hover:text-amber-400">
          OSRS Loot Simulator
        </Link>
        <div className="flex items-baseline gap-3 text-xs text-neutral-600">
          <span className="hidden sm:inline">
            data from the{' '}
            <a
              href="https://oldschool.runescape.wiki/"
              target="_blank"
              rel="noreferrer"
              className="hover:text-neutral-400 hover:underline"
            >
              OSRS Wiki
            </a>
          </span>
          {!onAdmin && (
            <Link to="/admin" className="hover:text-neutral-400 hover:underline">
              admin
            </Link>
          )}
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/boss/:slug" element={<HomePage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="*" element={<HomePage />} />
        </Routes>
      </main>

      <Footer reserveActionBar={onBoss} />
    </div>
  )
}
