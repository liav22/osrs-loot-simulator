import { test as base, type Page } from '@playwright/test'

/**
 * Every test gets the live GE price endpoint stubbed out.
 *
 * Two reasons, both load-bearing. The suite must not depend on a third-party
 * service being up (or on PROJECT_PLAN.md 6.2's etiquette rules being honoured
 * by a test loop). And `BossView` gates its Simulate button on the price query
 * settling — `buttonState` is 'loading-prices' until then — so an unstubbed
 * run would be timing out on a network call while looking like a UI defect.
 *
 * The stub returns a well-formed empty price map rather than failing the
 * request: prices only affect the gp columns, which nothing here asserts, and
 * an empty map is the same "untradeable prices at 0" path `gePriceLookup`
 * already takes in production.
 */
export const test = base.extend<{ page: Page }>({
  page: async ({ page }, use) => {
    await page.route('**://prices.runescape.wiki/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: {} }),
      })
    )
    await use(page)
  },
})

export { expect } from '@playwright/test'
