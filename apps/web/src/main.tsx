import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import { App } from './App'
import { queryClient } from './lib/queryClient'
import './index.css'

const container = document.getElementById('root')
if (!container) throw new Error('#root element not found')

// GitHub Pages gotcha #2 (PROJECT_PLAN.md 9): there's no server, so a direct
// link or refresh on e.g. /boss/vorkath 404s. dist/404.html is a copy of
// index.html (scripts/copy-404.mjs) so GitHub serves this same app for that
// path; `basename` here is what then makes the router recognise the
// subpath-prefixed URL it was actually served from.
createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>
)
