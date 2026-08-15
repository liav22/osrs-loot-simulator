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
/**
 * A 1x1 transparent PNG. Stands in for every wiki image the page asks for.
 *
 * The UI rework put boss portraits and per-item icons on screen, all of them
 * hot-linked to oldschool.runescape.wiki. Left unstubbed, this suite would
 * make dozens of real image requests per test — a third-party dependency for
 * assertions that are about layout, and precisely the bulk traffic
 * PROJECT_PLAN.md 6.2's etiquette rules are about. It would also make
 * `pages-deploy.spec.ts`'s "no 404s" assertion depend on the wiki's own
 * inventory rather than on this app's deploy, which is not what that test is
 * for.
 *
 * Tests that care about the icon FALLBACK behaviour override this route
 * themselves — see `results.spec.ts`.
 */
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
)

export const test = base.extend<{ page: Page }>({
  page: async ({ page }, use) => {
    await page.route('**://prices.runescape.wiki/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: {} }),
      })
    )
    await page.route('**://oldschool.runescape.wiki/**', (route) =>
      route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL })
    )
    await use(page)
  },
})

export { expect } from '@playwright/test'

/**
 * A stable projection of a run's result: the summary line plus every item card
 * as "name xN".
 *
 * Deliberately not `innerText` of the results section. That was the comparison
 * two specs used, and it became flaky the moment icons arrived: `ItemIcon`
 * renders the item's first letter as a placeholder until the icon map query
 * resolves, so the section's text picks up a stray "W" or "B" depending purely
 * on whether that fetch landed before or after the first paint. The numbers a
 * run produces are what "the same result" means; the icon loading state is not.
 */
export async function resultProjection(page: Page): Promise<string> {
  const summary = (await page.getByTestId('results-summary').innerText()).trim()
  const items = await page.locator('[data-item-card]').evaluateAll((cards) =>
    cards.map((card) => {
      const name = card.querySelector('div[title]')?.getAttribute('title') ?? ''
      const count = card.querySelector('span')?.textContent ?? ''
      return `${name} ${count}`
    })
  )
  return [summary, ...items].join('\n')
}
