import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App } from '../src/App'

const FAKE_INDEX = {
  generatedAt: '2026-01-01T00:00:00.000Z',
  entries: [
    { slug: 'giant-mole', name: 'Giant Mole', aliases: [], status: 'verified' },
    { slug: 'abyssal-sire', name: 'Abyssal Sire', aliases: [], status: 'needs_review' },
  ],
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

  it('renders the search box and loads the boss index on "/"', async () => {
    renderApp('/')
    expect(screen.getByPlaceholderText(/search a boss/i)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('Giant Mole')).toBeInTheDocument())
    expect(screen.getByText('Abyssal Sire')).toBeInTheDocument()
  })

  it('renders the attribution footer on every page', async () => {
    renderApp('/')
    expect(screen.getByText(/Old School RuneScape Wiki/)).toBeInTheDocument()
    expect(screen.getByText(/CC BY-NC-SA 3.0/)).toBeInTheDocument()
  })

  it('renders the admin page with the validation report header', async () => {
    renderApp('/admin')
    await waitFor(() => expect(screen.getByText('Validation report')).toBeInTheDocument())
    expect(screen.getByText(/2 sources/)).toBeInTheDocument()
  })
})
