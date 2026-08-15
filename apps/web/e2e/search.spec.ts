import { expect, test } from './fixtures'

test.use({ viewport: { width: 1920, height: 1080 } })

test('is empty until typed into, then shows at most five results', async ({ page }) => {
  await page.goto('./')
  const input = page.getByPlaceholder(/search a boss/i)
  await expect(input).toBeFocused()
  await expect(page.getByRole('option')).toHaveCount(0)

  // "a" matches most of the 52-entry index; the cap is what keeps the list
  // readable rather than a wall.
  await input.fill('a')
  await expect(page.getByRole('option')).toHaveCount(5)
})

test('is navigable by keyboard alone', async ({ page }) => {
  await page.goto('./')
  const input = page.getByPlaceholder(/search a boss/i)

  await input.fill('dagannoth')
  const options = page.getByRole('option')
  await expect(options.first()).toHaveAttribute('aria-selected', 'true')

  await page.keyboard.press('ArrowDown')
  await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('ArrowUp')
  await expect(options.first()).toHaveAttribute('aria-selected', 'true')

  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { name: /Dagannoth/ })).toBeVisible()
  expect(new URL(page.url()).pathname).toContain('/boss/dagannoth-')
})

test('escape clears the query and hides the list', async ({ page }) => {
  await page.goto('./')
  const input = page.getByPlaceholder(/search a boss/i)
  await input.fill('vorkath')
  await expect(page.getByRole('option')).toHaveCount(1)

  await page.keyboard.press('Escape')
  await expect(input).toHaveValue('')
  await expect(page.getByRole('option')).toHaveCount(0)
})

test('selecting a boss replaces search, and "change boss" comes back', async ({ page }) => {
  await page.goto('./boss/vorkath')
  await expect(page.getByRole('heading', { name: 'Vorkath' })).toBeVisible()
  await expect(page.getByPlaceholder(/search a boss/i)).toHaveCount(0)

  await page.getByRole('link', { name: /change boss/ }).click()
  await expect(page.getByPlaceholder(/search a boss/i)).toBeVisible()
})
