import { defineConfig, devices } from '@playwright/test'

/**
 * The real-browser suite, deliberately run against the PRODUCTION build served
 * under the GitHub Pages subpath — not `vite dev` and not `vite preview`.
 *
 * Everything jsdom can already check (a component renders the controls its
 * boss document implies) is checked by `test/*.test.tsx`. What jsdom
 * structurally cannot reach, and what this suite exists for:
 *
 *  - `import.meta.env.BASE_URL` is only `/osrs-loot-simulator/` in a build with
 *    GITHUB_ACTIONS set, so every asset and data URL the app derives from it is
 *    a different string in production than in any test that has ever run here.
 *  - A hard load of a deep link goes through GitHub Pages' 404.html mechanism
 *    and the router's `basename`. jsdom has no navigation and no server.
 *  - The simulation runs in a real Web Worker (`new Worker(new URL(...))`),
 *    which is a build-time transform, not a runtime one.
 *  - History updates from `setSearchParams` are real browser history entries.
 *
 * `webServer` builds with GITHUB_ACTIONS=1 and serves the result through
 * e2e/gh-pages-server.mjs, whose header explains why a preview server would
 * make this test agree with a broken deploy.
 */

const PORT = 4178
const BASE = '/osrs-loot-simulator/'

export default defineConfig({
  testDir: './e2e',
  // Deep links and history assertions are order-independent; parallel is safe.
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}${BASE}`,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // GITHUB_ACTIONS=1 is what flips vite.config.ts's `base` to the subpath.
    // Building here rather than expecting a prebuilt dist/ keeps the suite
    // honest: it can never pass against a stale build from a previous config.
    command: `GITHUB_ACTIONS=1 pnpm build && node e2e/gh-pages-server.mjs --base ${BASE} --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}${BASE}`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'pipe',
  },
})
