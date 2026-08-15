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
