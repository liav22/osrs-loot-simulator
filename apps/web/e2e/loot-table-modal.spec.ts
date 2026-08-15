import { expect, test } from './fixtures'

/**
 * The loot table moved behind a button. That relocation is only a win if the
 * modal behaves like a modal — otherwise it is the same content with an extra
 * click in front of it.
 *
 * Focus trapping and body-scroll locking are exactly the class of behaviour
 * jsdom reports as working whether or not it does: it has no layout, so
 * `overflow: hidden` on <body> changes nothing observable, and
 * `element.focus()` succeeds on elements a real browser would skip.
 */

test.use({ viewport: { width: 1920, height: 1080 } })

test('opens over the app, renders the real table, and closes three ways', async ({ page }) => {
  await page.goto('./boss/vorkath')
  const open = page.getByRole('button', { name: 'View loot table' })

  await open.click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  // The relocation claim: the same rendering as before, tableRef chains and
  // all. Vorkath's own table names items directly.
  await expect(dialog.getByText('Draconic visage')).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  // Focus returns to the trigger, so keyboard users are not dumped at the top
  // of the document.
  await expect(open).toBeFocused()

  await open.click()
  await page.getByRole('button', { name: 'Close' }).click()
  await expect(page.getByRole('dialog')).toBeHidden()

  await open.click()
  // Backdrop click: the corner is outside the panel at this viewport.
  await page.mouse.click(5, 5)
  await expect(page.getByRole('dialog')).toBeHidden()
})

test('traps focus inside while open', async ({ page }) => {
  await page.goto('./boss/vorkath')
  await page.getByRole('button', { name: 'View loot table' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()

  // Tab around more times than the dialog has focusable children and assert
  // focus never lands outside it. Counting tab stops would pin the modal's
  // internal markup; this pins the property that matters.
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab')
    const inside = await page.evaluate(() => {
      const panel = document.querySelector('[role="dialog"]')
      return panel !== null && panel.contains(document.activeElement)
    })
    expect(inside).toBe(true)
  }
})

test('scrolls its own body while the page behind stays put', async ({ page }) => {
  // The Mimic has one of the longest tables in the corpus, which is what makes
  // the modal body overflow at all.
  await page.goto('./boss/the-mimic')
  await page.getByRole('button', { name: 'View loot table' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()

  const body = dialog.locator('div').filter({ hasText: /./ }).last()
  const scrolled = await dialog.evaluate((panel) => {
    const region = [...panel.querySelectorAll('div')].find((d) => d.scrollHeight > d.clientHeight + 1)
    if (region === undefined) return null
    region.scrollTop = 200
    return region.scrollTop
  })
  expect(scrolled).toBeGreaterThan(0)
  expect(body).toBeTruthy()

  // The page itself never moved.
  expect(await page.evaluate(() => window.scrollY)).toBe(0)
  expect(await page.evaluate(() => document.body.style.overflow)).toBe('hidden')

  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toBeHidden()
  // And the lock is released rather than leaking into the rest of the session.
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden')
})

test('is full-screen below 600px rather than a centred dialog', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('./boss/vorkath')
  await page.getByRole('button', { name: 'View loot table' }).click()

  const box = await page.getByRole('dialog').boundingBox()
  expect(box?.width).toBeGreaterThanOrEqual(389)
  expect(box?.height).toBeGreaterThanOrEqual(840)
})
