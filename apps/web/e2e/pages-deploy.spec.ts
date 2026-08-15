import { expect, test } from './fixtures'

/**
 * PROJECT_PLAN.md section 9 names two GitHub Pages failures that "will bite
 * you": the base path, and SPA routing on a hard load. Both are invisible to
 * every test this repo had before this file — jsdom has no navigation, and the
 * subpath only exists in a build with GITHUB_ACTIONS set. See
 * playwright.config.ts for why this runs against the production build served
 * through a GitHub Pages mimic rather than `vite preview`.
 */

test('the app root loads under the /osrs-loot-simulator/ subpath', async ({ page }) => {
  const response = await page.goto('./')
  expect(response?.status()).toBe(200)

  // "OSRS Loot Simulator" is no longer a heading: it moved into a persistent
  // header as a home link, so that each page's own <h1> can name what the page
  // is actually about (on /boss/:slug that is the boss). Asserting the link
  // plus the search input keeps this test's real subject — did the app boot
  // under the subpath at all — while not pinning markup the rework changed on
  // purpose.
  await expect(page.getByRole('link', { name: 'OSRS Loot Simulator' })).toBeVisible()
  await expect(page.getByPlaceholder(/search a boss/i)).toBeVisible()
})

test('every asset the page requests resolves — no 404 under the subpath', async ({ page }) => {
  // This is the "white page with 404s on every asset" failure the plan calls
  // the single most common Pages mistake. A wrong `base` produces exactly
  // this and nothing else about the page would look wrong in jsdom.
  const missing: string[] = []
  page.on('response', (response) => {
    if (response.status() === 404) missing.push(`${response.status()} ${response.url()}`)
  })

  await page.goto('./boss/vorkath')
  await expect(page.getByRole('heading', { name: 'Vorkath' })).toBeVisible()
  await expect(page.getByText('Loading shared tables…')).toBeHidden()

  // The document itself is legitimately a 404 (that IS the mechanism — see
  // below). Every subresource must not be.
  const subresource404s = missing.filter((url) => !url.endsWith('/boss/vorkath'))
  expect(subresource404s).toEqual([])
})

test('a hard-loaded deep link is served as 404.html and recovered by the router', async ({ page }) => {
  // The whole point of scripts/copy-404.mjs. GitHub Pages answers an unknown
  // path with 404.html at an HTTP 404 status; because that file is a copy of
  // index.html, the SPA boots and the router reads the real URL. Asserting the
  // status is 404 AND the app rendered is what distinguishes "the fallback
  // works" from "a preview server quietly rewrote the request".
  const response = await page.goto('./boss/zalcano?mvp=1&hpdmg=500&shielddmg=40')
  expect(response?.status()).toBe(404)

  await expect(page.getByRole('heading', { name: 'Zalcano' })).toBeVisible()
  // The router's basename stripped the subpath rather than treating it as
  // part of the route — if it hadn't, this would have fallen through to the
  // catch-all route and rendered search with no boss.
  expect(new URL(page.url()).pathname).toBe('/osrs-loot-simulator/boss/zalcano')
})

test('boss data is fetched from the subpath, not the server root', async ({ page }) => {
  // `assetUrl` builds every data URL from import.meta.env.BASE_URL. A regression
  // to a leading-slash literal would request /bosses/vorkath.json, which the
  // GitHub Pages mimic answers with a plain 404 (outside the base prefix), and
  // the boss would never load.
  const dataRequests: string[] = []
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname
    if (path.endsWith('.json')) dataRequests.push(path)
  })

  await page.goto('./boss/vorkath')
  await expect(page.getByRole('heading', { name: 'Vorkath' })).toBeVisible()

  expect(dataRequests.length).toBeGreaterThan(0)
  for (const path of dataRequests) {
    expect(path.startsWith('/osrs-loot-simulator/')).toBe(true)
  }
})

test('in-app links stay inside the base path', async ({ page }) => {
  // Zalcano is not `verified`, so BossView renders its admin-page link. Any
  // app-internal href that forgets BASE_URL points at a path that belongs to a
  // different site on the real host — the mimic server answers it with a plain
  // 404 and no app at all.
  await page.goto('./boss/zalcano')
  await expect(page.getByRole('heading', { name: 'Zalcano' })).toBeVisible()

  const hrefs = await page.locator('a[href^="/"]').evaluateAll((links) =>
    links.map((link) => link.getAttribute('href') ?? '')
  )
  const escaped = hrefs.filter((href) => !href.startsWith('/osrs-loot-simulator/'))
  expect(escaped).toEqual([])
})

test('the admin page is reachable at its deep link', async ({ page }) => {
  const response = await page.goto('./admin')
  expect(response?.status()).toBe(404) // the 404.html mechanism again
  await expect(page.getByRole('heading', { level: 1 })).toContainText(/validation|admin/i)
})
