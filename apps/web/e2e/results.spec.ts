import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test as base, expect } from '@playwright/test'
import { test } from './fixtures'

// ESM: this suite runs as a module, so `__dirname` does not exist.
const HERE = dirname(fileURLToPath(import.meta.url))

test.use({ viewport: { width: 1920, height: 1080 } })

test('the uniques strip appears only when a curated unique or pet actually dropped', async ({ page }) => {
  // 200,000 Vorkath kills at a fixed seed: Draconic visage is a curated
  // unique at 1/5,000, so several land. The strip is the payoff for running
  // a simulation and should not require scanning a grid to find.
  await page.goto('./boss/vorkath?n=200000&seed=21')
  await page.getByRole('button', { name: 'Simulate' }).click()
  await expect(page.getByTestId('results-summary')).toBeVisible({ timeout: 60_000 })

  await expect(page.getByText('Uniques')).toBeVisible()
  const strip = page.locator('div').filter({ hasText: /^Uniques/ }).first()
  await expect(strip.getByText('Draconic visage')).toBeVisible()

  // One kill: no curated unique or pet drops, and the strip is absent
  // ENTIRELY rather than rendering an empty "no uniques" state, which reads
  // as a failed run.
  await page.goto('./boss/vorkath?n=1&seed=21')
  await page.getByRole('button', { name: 'Simulate' }).click()
  await expect(page.getByTestId('results-summary')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('Uniques')).toHaveCount(0)
})

test('every icon is requested at its resolved file name, not a guess', async ({ page }) => {
  // The whole point of `data/item-icons.json`: the browser asks for the file
  // the wiki actually has, first time, every time.
  //
  // Asserted against the committed map rather than against one hand-picked
  // item. The obvious version of this test named `Zulrah's scales` — the
  // clearest stack-suffix case — and failed, because under the rarity sort
  // that a price-less run uses, the commonest drop on the boss lands past the
  // 24-card collapse and is never rendered. Checking the whole request set
  // against the map has no such dependence on sort order, collapse or which
  // items a seed happened to produce.
  const icons = JSON.parse(
    readFileSync(join(HERE, '..', '..', '..', 'data', 'item-icons.json'), 'utf8')
  ) as { icons: Record<string, string> }
  const validPaths = new Set(Object.values(icons.icons).map((file) => file.replace(/ /g, '_')))

  const requested: string[] = []
  page.on('request', (request) => {
    const url = request.url()
    if (url.includes('oldschool.runescape.wiki/images/')) requested.push(decodeURIComponent(url))
  })

  await page.goto('./boss/zulrah?n=5000&seed=3')
  await page.getByRole('button', { name: 'Simulate' }).click()
  await expect(page.getByTestId('results-summary')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: /^Show all \d+$/ }).click()
  await expect(page.locator('[data-item-card]').first()).toBeVisible()

  await expect.poll(() => requested.length).toBeGreaterThan(5)

  // Every icon request names a file the map says exists. A name-derived guess
  // that happened to be wrong would not be in this set — that is the 13.6%.
  const itemIcons = requested
    .map((url) => url.split('/images/')[1] ?? '')
    .filter((path) => !path.startsWith('thumb/')) // the boss portrait
  const unknown = itemIcons.filter((path) => !validPaths.has(path))
  expect(unknown).toEqual([])

  // And the resolved path is really being exercised, not merely coincident
  // with the name: at least one request carries a stack suffix, which no rule
  // over the item name could have produced.
  expect(itemIcons.some((path) => /_\d+\.png$/.test(path))).toBe(true)

  // Special:FilePath is gone — it was a second request per miss against a
  // MediaWiki special page that rate-limits, and there is nothing left for it
  // to catch.
  expect(requested.filter((url) => url.includes('Special:FilePath'))).toEqual([])
})

test('an icon that fails to load renders a placeholder, never a broken image', async ({ page }) => {
  // No known failure class remains, but an image can still fail on a re-upload
  // between ingest runs or a flaky network.
  await page.route('**://oldschool.runescape.wiki/images/**', (route) =>
    route.fulfill({ status: 404, body: '' })
  )

  await page.goto('./boss/vorkath?n=5000&seed=3')
  await page.getByRole('button', { name: 'Simulate' }).click()
  await expect(page.getByTestId('results-summary')).toBeVisible({ timeout: 30_000 })

  const cards = page.locator('[data-item-card]')
  await expect(cards.first()).toBeVisible()

  const cardCount = await cards.count()
  expect(cardCount).toBeGreaterThan(5)

  // With every image 404'd, every icon must have been REPLACED — no <img>
  // should survive in the grid at all.
  //
  // Asserting "no zero-width <img>" instead would pass vacuously here for the
  // same reason it is true: there would be no <img> elements left to check.
  // The positive assertion is that each card still has an icon slot, filled by
  // the letter placeholder.
  await expect.poll(() => cards.locator('img').count(), { timeout: 15_000 }).toBe(0)
  const placeholders = await page.locator('[data-item-card] span[aria-hidden="true"]').count()
  expect(placeholders).toBe(cardCount)
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
