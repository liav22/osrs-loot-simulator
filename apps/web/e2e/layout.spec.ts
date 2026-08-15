import { expect, test } from './fixtures'

/**
 * The rework's central claim: the whole interface fits a 1080p viewport with no
 * page-level scroll, and the layout does not jump when results arrive.
 *
 * These assertions only mean anything in a real browser at a real size. jsdom
 * has no layout, so `scrollHeight` there is a fiction and every one of these
 * would pass against a page that is four screens tall.
 */

async function pageScrolls(page: import('@playwright/test').Page): Promise<boolean> {
  return page.evaluate(() => {
    const doc = document.documentElement
    // A pixel of slack: sub-pixel rounding on borders is not a scrollbar.
    return doc.scrollHeight > doc.clientHeight + 1 || doc.scrollWidth > doc.clientWidth + 1
  })
}

test.describe('1920x1080', () => {
  test.use({ viewport: { width: 1920, height: 1080 } })

  test('never scrolls the page across load, search, select and simulate', async ({ page }) => {
    await page.goto('./')
    expect(await pageScrolls(page)).toBe(false)

    await page.getByPlaceholder(/search a boss/i).fill('vorkath')
    await expect(page.getByRole('option', { name: /Vorkath/ })).toBeVisible()
    expect(await pageScrolls(page)).toBe(false)

    await page.getByRole('button', { name: /^Vorkath/ }).click()
    await expect(page.getByRole('heading', { name: 'Vorkath' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Simulate' })).toBeEnabled()
    expect(await pageScrolls(page)).toBe(false)

    await page.getByRole('button', { name: 'Simulate' }).click()
    await expect(page.getByTestId('results-summary')).toBeVisible({ timeout: 30_000 })
    expect(await pageScrolls(page)).toBe(false)
  })

  test('the results column does not change size when results arrive', async ({ page }) => {
    // "The layout must not jump when results arrive" — the empty state exists
    // for this and nothing else, so it is worth an assertion rather than a
    // comment.
    await page.goto('./boss/vorkath?n=2000&seed=4')
    const results = page.getByTestId('results')
    await expect(page.getByRole('button', { name: 'Simulate' })).toBeEnabled()
    const before = await results.boundingBox()

    await page.getByRole('button', { name: 'Simulate' }).click()
    await expect(page.getByTestId('results-summary')).toBeVisible({ timeout: 30_000 })
    const after = await results.boundingBox()

    expect(after?.width).toBeCloseTo(before?.width ?? 0, 0)
    expect(after?.height).toBeCloseTo(before?.height ?? 0, 0)
  })

  test('a large table at 1,000,000 kills collapses, expands, and overflows nothing', async ({ page }) => {
    // The Mimic is the stress case: 3rd age everything, 60+ distinct items at
    // this kill count, and the reason the grid collapses at all.
    await page.goto('./boss/the-mimic?n=1000000&seed=11')
    await page.getByRole('button', { name: 'Simulate' }).click()
    await expect(page.getByTestId('results-summary')).toBeVisible({ timeout: 60_000 })

    const showAll = page.getByRole('button', { name: /^Show all \d+$/ })
    await expect(showAll).toBeVisible()

    const collapsed = await page.getByTestId('results').locator('[data-item-card]').count()
    expect(collapsed).toBe(24)

    await showAll.click()
    const expanded = await page.getByTestId('results').locator('[data-item-card]').count()
    expect(expanded).toBeGreaterThan(collapsed)
    expect(await pageScrolls(page)).toBe(false)

    await page.getByRole('button', { name: 'Show fewer' }).click()
    expect(await page.getByTestId('results').locator('[data-item-card]').count()).toBe(24)
  })
})

test.describe('other viewports', () => {
  for (const [width, height] of [
    [1280, 800],
    [900, 600],
  ] as const) {
    test(`${width}x${height} keeps Simulate reachable without page scroll`, async ({ page }) => {
      await page.setViewportSize({ width, height })
      await page.goto('./boss/zulrah')
      await expect(page.getByRole('heading', { name: 'Zulrah' })).toBeVisible()

      const simulate = page.getByRole('button', { name: 'Simulate' })
      await expect(simulate).toBeInViewport()
      expect(await pageScrolls(page)).toBe(false)
    })
  }

  test('390x844 stacks to one column and pins Simulate to the viewport', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('./boss/zulrah')
    await expect(page.getByRole('heading', { name: 'Zulrah' })).toBeVisible()

    const simulate = page.getByRole('button', { name: 'Simulate' })
    await expect(simulate).toBeInViewport()

    // Page scroll IS expected here — section 8 allows it below 900px. What must
    // hold is that the button survives it, which is the whole reason it is
    // fixed rather than sticky: on a phone the results sit BELOW the boss
    // panel, so a sticky button would leave the moment someone scrolled down to
    // read what dropped.
    await page.mouse.wheel(0, 3000)
    await expect(simulate).toBeInViewport()

    // One column: the results sit BELOW the boss panel and span the same
    // width, rather than beside it.
    //
    // Measured on the panel container, not on the <h1>. Below 900px the panel's
    // header is a flex row with the boss image beside the name, so the heading
    // starts ~120px in and comparing its x to the results' x measures that
    // inner layout instead of the column count.
    const panel = await page.getByRole('button', { name: 'View loot table' }).boundingBox()
    const results = await page.getByTestId('results').boundingBox()
    expect(results?.y ?? 0).toBeGreaterThan(panel?.y ?? 0)
    expect(results?.width).toBeCloseTo(panel?.width ?? 0, -1)
  })
})
