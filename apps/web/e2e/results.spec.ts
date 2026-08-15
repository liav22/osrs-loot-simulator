import { test as base, expect } from '@playwright/test'
import { test } from './fixtures'

test.use({ viewport: { width: 1920, height: 1080 } })

test('the rarest-drops strip appears only when something rare actually dropped', async ({ page }) => {
  // 200,000 Vorkath kills at a fixed seed: visages are 1/5,000, so several
  // land. The strip is the payoff for running a simulation and should not
  // require scanning a grid to find.
  await page.goto('./boss/vorkath?n=200000&seed=21')
  await page.getByRole('button', { name: 'Simulate' }).click()
  await expect(page.getByTestId('results-summary')).toBeVisible({ timeout: 60_000 })

  await expect(page.getByText('Rarest drops')).toBeVisible()
  const strip = page.locator('div').filter({ hasText: /^Rarest drops/ }).first()
  await expect(strip.getByText('Draconic visage')).toBeVisible()

  // One kill: nothing rare drops, and the strip is absent ENTIRELY rather than
  // rendering an empty "no rare drops" state, which reads as a failed run.
  //
  // One rather than ten. Vorkath's rarest own-table drops sum to roughly 1/260
  // per kill, so across ten kills something qualifies more often than not —
  // which is what this originally asserted against and lost.
  await page.goto('./boss/vorkath?n=1&seed=21')
  await page.getByRole('button', { name: 'Simulate' }).click()
  await expect(page.getByTestId('results-summary')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('Rarest drops')).toHaveCount(0)
})

test('an icon that 404s falls back and never renders a broken image', async ({ page }) => {
  // Overrides the fixture's blanket image stub for the direct CDN path only,
  // leaving Special:FilePath served. This is the measured 13.6% case — every
  // stackable item, whose icon file carries a stack-size suffix the item name
  // does not mention.
  await page.route('**://oldschool.runescape.wiki/images/**', (route) =>
    route.fulfill({ status: 404, body: '' })
  )

  await page.goto('./boss/vorkath?n=5000&seed=3')
  await page.getByRole('button', { name: 'Simulate' }).click()
  await expect(page.getByTestId('results-summary')).toBeVisible({ timeout: 30_000 })

  const cards = page.locator('[data-item-card]')
  await expect(cards.first()).toBeVisible()

  // Every icon either loaded something or was replaced by the letter
  // placeholder. A zero-sized <img> is the broken-image glyph, which is the
  // failure mode this is guarding.
  //
  // The wait is not optional: icons are `loading="lazy"`, and an image that has
  // simply not started yet also reports naturalWidth 0. Without settling first
  // this passes or fails on timing rather than on the fallback working.
  await page.waitForFunction(
    () => [...document.querySelectorAll('[data-item-card] img')].every((img) => (img as HTMLImageElement).complete),
    undefined,
    { timeout: 15_000 }
  )
  const broken = await page.evaluate(() =>
    [...document.querySelectorAll('[data-item-card] img')].filter(
      (img) => (img as HTMLImageElement).naturalWidth === 0
    ).length
  )
  expect(broken).toBe(0)
})

/**
 * The price-fetch failure path, with its own `test` rather than the shared
 * fixture: the fixture stubs prices with a well-formed empty map, and this
 * needs the request to actually fail.
 */
const testWithBlockedPrices = base.extend({
  page: async ({ page }, use) => {
    await page.route('**://prices.runescape.wiki/**', (route) => route.abort())
    await page.route('**://oldschool.runescape.wiki/**', (route) =>
      route.fulfill({ status: 404, body: '' })
    )
    await use(page)
  },
})

testWithBlockedPrices.use({ viewport: { width: 1920, height: 1080 } })

testWithBlockedPrices(
  'with prices blocked, Simulate still works and the grid sorts by rarity, labelled',
  async ({ page }) => {
    await page.goto('./boss/vorkath?n=50000&seed=8')
    await expect(page.getByRole('heading', { name: 'Vorkath' })).toBeVisible()

    // The old build disabled Simulate until the price query settled, which made
    // a third-party outage look like a broken app. With a defined fallback that
    // gate is gone.
    const simulate = page.getByRole('button', { name: 'Simulate' })
    await expect(simulate).toBeEnabled()
    await simulate.click()
    await expect(page.getByTestId('results-summary')).toBeVisible({ timeout: 60_000 })

    // Labelled, so the order never looks arbitrary.
    await expect(page.getByText(/sorted by rarity \(prices unavailable\)/)).toBeVisible()

    // And it really is rarity order. Expanded first: collapsed to 24 cards the
    // commonest drop is off the end of the list, so its position could not be
    // asserted at all.
    await page.getByRole('button', { name: /^Show all \d+$/ }).click()
    const names = await page.locator('[data-item-card]').evaluateAll((cards) =>
      cards.map((card) => card.querySelector('div[title]')?.textContent ?? '')
    )
    expect(names.length).toBeGreaterThan(1)
    // Two per kill, guaranteed — the commonest drop Vorkath has, so under
    // rarest-first it must be last and cannot be first.
    expect(names[0]).not.toBe('Blue dragonhide')
    expect(names[names.length - 1]).toBe('Blue dragonhide')
  }
)
