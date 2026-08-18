import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App } from '../src/App'

const FAKE_INDEX = {
  generatedAt: '2026-01-01T00:00:00.000Z',
  entries: [
    { slug: 'giant-mole', name: 'Giant Mole', aliases: [], status: 'verified', statusTier: 'verified', repeatable: true },
    {
      slug: 'abyssal-sire',
      name: 'Abyssal Sire',
      aliases: [],
      status: 'needs_review',
      statusTier: 'minor_gaps',
      repeatable: true,
    },
    // A boss fought once during a quest and never again — present in the
    // index (nothing is deleted) but excluded from search by default.
    { slug: 'me', name: 'Me', aliases: [], status: 'verified', statusTier: 'verified', repeatable: false },
  ],
  // The shared-table manifest the browser fetches `data/tables/` by. Required
  // by the strict schema — the site index is a boundary, so a response missing
  // it is rejected rather than defaulted, which is the point.
  tables: ['rare_drop_table'],
}

function renderApp(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>
  )
}

describe('App', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.endsWith('index.json')) {
          return new Response(JSON.stringify(FAKE_INDEX), { status: 200 })
        }
        return new Response('not found', { status: 404 })
      })
    )
  })

  /**
   * This used to assert that both index entries were on screen after load.
   * They no longer are, and that is the change rather than a regression: the
   * boss list is hidden until something is typed. An always-visible list of 52
   * sources was most of the page's height and none of its purpose. What still
   * has to hold is that the index really loaded and really drives the filter,
   * so the assertion moved from "the list is rendered" to "typing finds an
   * entry from the fetched index, and only the matching one."
   */
  it('renders the search box and shows nothing until a query is typed', async () => {
    renderApp('/')
    const input = screen.getByPlaceholderText(/search a boss/i)
    expect(input).toBeInTheDocument()

    // The index request settles; the list stays empty regardless.
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(screen.queryByText('Giant Mole')).not.toBeInTheDocument()
    expect(screen.queryByText('Abyssal Sire')).not.toBeInTheDocument()
  })

  it('filters the fetched index as you type, and lists only matches', async () => {
    renderApp('/')
    // `fireEvent.change` rather than user-event: this repo doesn't carry that
    // dependency, and a single controlled-input change is all this asserts.
    fireEvent.change(screen.getByPlaceholderText(/search a boss/i), { target: { value: 'mole' } })

    await waitFor(() => expect(screen.getByText('Giant Mole')).toBeInTheDocument())
    expect(screen.queryByText('Abyssal Sire')).not.toBeInTheDocument()
  })

  /**
   * A source fought once during a quest and never again is in the index
   * (nothing is deleted — see docs/DECISIONS.md) and matches this query
   * exactly, but a loot simulator has nothing to say about a source you can
   * only sample once, so it must not appear here even on an exact-name match.
   */
  it('excludes a non-repeatable source from search, even on an exact match', async () => {
    renderApp('/')
    fireEvent.change(screen.getByPlaceholderText(/search a boss/i), { target: { value: 'Me' } })

    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(screen.queryByText('Me')).not.toBeInTheDocument()
  })

  it('renders the attribution footer on every page', async () => {
    renderApp('/')
    expect(screen.getByText(/Old School RuneScape Wiki/)).toBeInTheDocument()
    expect(screen.getByText(/CC BY-NC-SA 3.0/)).toBeInTheDocument()
  })

  it('links to the source repository from the header, safely and accessibly', async () => {
    renderApp('/')
    // Found by its accessible name, which is the assertion that matters: an
    // icon-only link with no name is invisible to a screen reader, and a
    // class-based query would pass just as happily without one.
    const link = screen.getByRole('link', { name: /source code on github/i })
    expect(link).toHaveAttribute('href', 'https://github.com/liav22/osrs-loot-simulator')
    expect(link).toHaveAttribute('target', '_blank')
    // `noopener` denies the opened tab a handle on this window; `noreferrer`
    // withholds the referrer. Asserted as separate tokens so re-ordering them
    // does not fail, and dropping one does.
    const rel = link.getAttribute('rel')?.split(/\s+/) ?? []
    expect(rel).toContain('noopener')
    expect(rel).toContain('noreferrer')
    // The glyph must not be announced — the anchor already carries the name.
    expect(link.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  })

  /**
   * The admin page is dev-only now (`import.meta.env.DEV`), and Vitest runs in
   * dev mode, so it still renders here — which is the right coverage: this is
   * the environment maintainers actually use it in. That it is ABSENT from the
   * production bundle is asserted where that can be observed, against the real
   * build, in `e2e/pages-deploy.spec.ts`.
   *
   * `findByText` rather than `getByText` in a `waitFor`: the route is behind a
   * `lazy()` boundary now, so the first render is the Suspense fallback.
   */
  it('renders the admin page with the validation report header in dev', async () => {
    expect(import.meta.env.DEV).toBe(true)
    renderApp('/admin')
    expect(await screen.findByText('Validation report')).toBeInTheDocument()
    expect(screen.getByText(/3 sources/)).toBeInTheDocument()
  })
})
