import { expect, resultProjection, test } from './fixtures'

test('unpriced runs label the summary without presenting zero GP', async ({ page }) => {
  await page.goto('./boss/vorkath?n=100&seed=7&run=1')
  const summary = page.getByTestId('results-summary')
  await expect(summary).toContainText('Prices unavailable')
  await expect(summary).not.toContainText('gp')
  await expect(page.locator('[data-item-card]').first()).toBeVisible()
})

test('changed settings flag results, preserve their odds, and clear on restore or rerun', async ({ page }) => {
  await page.goto('./boss/brutus?n=1000&seed=7&run=1')
  await expect(page.getByTestId('results-summary')).toBeVisible()
  const original = await resultProjection(page)
  const notice = page.getByRole('status')
  await expect(notice).toHaveCount(0)

  await page.getByLabel('Kills to simulate').fill('1001')
  await expect(notice).toContainText('Settings changed')
  expect(await resultProjection(page)).toBe(original)
  await page.getByLabel('Kills to simulate').fill('1000')
  await expect(notice).toHaveCount(0)

  await page.getByLabel('Seed').fill('8')
  await expect(notice).toBeVisible()
  await page.getByLabel('Seed').fill('7')
  await expect(notice).toHaveCount(0)

  await page.locator('[data-item-card]').first().click()
  const odds = await page.getByRole('dialog').innerText()
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByLabel('Free-to-play').check()
  await expect(notice).toBeVisible()
  await page.locator('[data-item-card]').first().click()
  expect(await page.getByRole('dialog').innerText()).toBe(odds)
  await page.getByRole('button', { name: 'Close', exact: true }).click()

  await page.getByRole('button', { name: 'Simulate', exact: true }).click()
  await expect(page.getByTestId('results-summary')).toBeVisible()
  await expect(notice).toHaveCount(0)
})

test('random seed mode does not mark a newly completed run as stale', async ({ page }) => {
  await page.goto('./boss/vorkath?n=100')
  await page.getByRole('button', { name: 'Simulate', exact: true }).click()
  await expect(page.getByTestId('results-summary')).toBeVisible()
  await expect(page.getByLabel('Seed')).toHaveValue('0')
  await expect(page.getByRole('status')).toHaveCount(0)
})

test('full caveats are readable on a phone and return focus when closed', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('./boss/nex')
  const opener = page.getByRole('button', { name: 'Read full caveat' })
  await opener.click()
  const dialog = page.getByRole('dialog', { name: 'Nex — data caveat' })
  await expect(dialog).toBeVisible()
  const response = await page.request.get('./bosses/nex.json')
  const boss = await response.json() as { statusReason: string }
  await expect(dialog.locator('p')).toHaveText(boss.statusReason)
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await expect(opener).toBeFocused()
})
