import { test as base } from '@playwright/test'
import { expect, resultProjection, test } from './fixtures'

/**
 * Section 9: the full result state survives a page load.
 *
 * The seed was already in the URL, and `url-round-trip.spec.ts` already proves
 * two runs at the same seed match. What was missing is the part a person
 * actually experiences: paste someone's link and SEE their result, rather than
 * landing on an empty panel with their seed pre-filled and having to press
 * Simulate yourself.
 */

test.use({ viewport: { width: 1920, height: 1080 } })


test('a link produced by pressing Simulate reproduces the run on load', async ({ page }) => {
  await page.goto('./boss/vorkath?n=20000&seed=77')
  await page.getByRole('button', { name: 'Simulate' }).click()
  await expect(page.getByTestId('results-summary')).toBeVisible({ timeout: 60_000 })

  // Pressing Simulate stamps the run into the URL.
  const shared = page.url()
  expect(new URL(shared).searchParams.get('run')).toBe('1')
  const original = await resultProjection(page)

  // A cold load of that link — a fresh boot through the 404.html fallback, a
  // fresh worker — lands on the same numbers with nothing clicked.
  await page.goto(shared)
  await expect(page.getByTestId('results-summary')).toBeVisible({ timeout: 60_000 })
  expect(await resultProjection(page)).toBe(original)
})

test('seed 0 rolls a fresh seed each click, and leaves the input on 0', async ({ page }) => {
  await page.goto('./boss/vorkath?n=3000')
  const seedInput = page.getByLabel('Seed')
  await expect(seedInput).toHaveValue('0')

  async function runOnce(): Promise<{ urlSeed: string; shown: string }> {
    await page.getByRole('button', { name: 'Simulate' }).click()
    await expect(page.getByTestId('results-summary')).toBeVisible({ timeout: 60_000 })
    const summary = await page.getByTestId('results-summary').innerText()
    return {
      urlSeed: new URL(page.url()).searchParams.get('seed') ?? '',
      shown: /seed (\d+)/.exec(summary)?.[1] ?? '',
    }
  }

  const first = await runOnce()
  expect(Number(first.urlSeed)).toBeGreaterThan(0)
  // The summary reports the seed that was actually used, which is the only
  // place someone can read a rolled value back.
  expect(first.shown).toBe(first.urlSeed)
  // And the control still says 0, so the next click rolls again rather than
  // repeating this run.
  await expect(seedInput).toHaveValue('0')

  const second = await runOnce()
  expect(second.urlSeed).not.toBe(first.urlSeed)
  await expect(seedInput).toHaveValue('0')

  // The rolled link still replays exactly — the sentinel never reaches the URL.
  const replayed = page.url()
  const before = await resultProjection(page)
  await page.goto(replayed)
  await expect(page.getByTestId('results-summary')).toBeVisible({ timeout: 60_000 })
  expect(await resultProjection(page)).toBe(before)
})

test('an explicit seed is used as typed and not rolled over', async ({ page }) => {
  await page.goto('./boss/vorkath?n=3000&seed=1234')
  await expect(page.getByLabel('Seed')).toHaveValue('1234')

  await page.getByRole('button', { name: 'Simulate' }).click()
  await expect(page.getByTestId('results-summary')).toBeVisible({ timeout: 60_000 })
  await expect(page.getByTestId('results-summary')).toContainText('seed 1234')
  expect(new URL(page.url()).searchParams.get('seed')).toBe('1234')
  await expect(page.getByLabel('Seed')).toHaveValue('1234')
})

test('a plain boss link does not auto-simulate, and keeps a clean URL', async ({ page }) => {
  await page.goto('./boss/vorkath')
  await expect(page.getByRole('heading', { name: 'Vorkath' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Simulate' })).toBeEnabled()

  // The empty state, not a result: nobody asked for a run, and a link that
  // silently starts one is a link that cannot be used to just look at a boss.
  await expect(page.getByTestId('results-summary')).toHaveCount(0)
  expect(new URL(page.url()).search).toBe('')
})

test('changing a control after a shared run does not re-fire the old simulation', async ({ page }) => {
  // The auto-run is latched to once per mount. Without the latch it re-fires
  // whenever the price query settles, which would overwrite results underneath
  // someone who had already moved on.
  await page.goto('./boss/vorkath?n=5000&seed=5&run=1')
  await expect(page.getByTestId('results-summary')).toBeVisible({ timeout: 60_000 })

  await page.getByLabel('Kills to simulate').fill('9999')
  await expect(page).toHaveURL(/n=9999/)

  // Still showing the 5,000-kill result: the new kill count applies to the next
  // run someone asks for, not retroactively.
  await expect(page.getByTestId('results-summary')).toContainText('5,000 kills')
})


/**
 * The auto-run waits for the GE price fetch to settle.
 *
 * Its own `test`, because the shared fixture returns a well-formed but EMPTY
 * price map — fine for every other assertion, useless for this one, since an
 * empty map is indistinguishable from no map at all.
 */
const testWithPrices = base.extend({
  page: async ({ page }, use) => {
    await page.route('**://prices.runescape.wiki/**', async (route) => {
      // Slow enough that an auto-run which does not wait will certainly lose
      // the race, which is exactly the bug this pins.
      await new Promise((r) => setTimeout(r, 750))
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        // 22124 is Superior dragon bones — two guaranteed per Vorkath kill, so
        // any priced run has a non-zero total.
        body: JSON.stringify({ data: { '22124': { high: 1000, low: 1000 } } }),
      })
    })
    await page.route('**://oldschool.runescape.wiki/**', (route) =>
      route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.alloc(0) })
    )
    await use(page)
  },
})

testWithPrices.use({ viewport: { width: 1920, height: 1080 } })

testWithPrices('a shared link waits for prices rather than reporting 0 gp', async ({ page }) => {
  await page.goto('./boss/vorkath?n=2000&seed=99&run=1')
  await expect(page.getByTestId('results-summary')).toBeVisible({ timeout: 60_000 })

  // Priced, and labelled as such. Before the wait, every shared link lost the
  // race to the price fetch and rendered "0 gp total" sorted by rarity — the
  // label was honest, but it was the wrong answer for the one feature whose
  // whole purpose is showing someone else your result.
  await expect(page.getByTestId('results-summary')).not.toContainText('0 gp total')
  await expect(page.getByText(/sorted by total value/)).toBeVisible()
})

testWithPrices('a click does NOT wait for prices — only the auto-run does', async ({ page }) => {
  // The asymmetry is deliberate. A click is user-initiated and must feel
  // instant; an auto-run has nobody waiting on it. Clicking during the 750ms
  // stall therefore runs unpriced, and says so.
  await page.goto('./boss/vorkath?n=2000&seed=99')
  const simulate = page.getByRole('button', { name: 'Simulate' })
  await expect(simulate).toBeEnabled()
  await simulate.click()
  await expect(page.getByTestId('results-summary')).toBeVisible({ timeout: 60_000 })
  await expect(page.getByText(/sorted by rarity \(prices unavailable\)/)).toBeVisible()
})
