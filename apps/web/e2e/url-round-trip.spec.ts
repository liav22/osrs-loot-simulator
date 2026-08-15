import { expect, test } from './fixtures'

/**
 * PROJECT_PLAN.md 9: "/boss/:slug — deep-linkable, context and seed encoded in
 * query params" and "put it in the URL so results are shareable and
 * reproducible."
 *
 * `test/url-state.test.ts` already checks that `paramsFromSearch` and
 * `searchFromParams` invert each other. That is a property of two pure
 * functions. What it cannot check is whether the app WIRES them up: whether a
 * pasted link actually populates the controls, whether moving a control writes
 * the URL back, and whether that survives a real page load. Those are three
 * different failures and all three are only observable in a browser.
 */

test('a pasted deep link populates the controls it names', async ({ page }) => {
  await page.goto('./boss/zalcano?mvp=1&hpdmg=500&shielddmg=40&seed=7&n=1234&slayer=1')
  await expect(page.getByRole('heading', { name: 'Zalcano' })).toBeVisible()

  await expect(page.getByLabel('MVP (most damage dealt)')).toBeChecked()
  await expect(page.getByLabel('On slayer task')).toBeChecked()
  await expect(page.getByLabel('Damage to hitpoints')).toHaveValue('500')
  await expect(page.getByLabel('Damage to shield')).toHaveValue('40')
  await expect(page.getByLabel('Seed')).toHaveValue('7')
  await expect(page.getByLabel('Kills to simulate')).toHaveValue('1234')
})

test('moving a control writes the URL back, and the URL survives a reload', async ({ page }) => {
  await page.goto('./boss/zalcano?hpdmg=500&shielddmg=40')
  await expect(page.getByLabel('Damage to shield')).toHaveValue('40')

  await page.getByLabel('Damage to shield').fill('12')
  await expect(page).toHaveURL(/shielddmg=12/)

  // The round trip that matters to a person: reload the page from the URL the
  // app just wrote and get the same state back. This goes through the 404.html
  // fallback and a fresh boot, not a client-side re-render.
  await page.reload()
  await expect(page.getByLabel('Damage to shield')).toHaveValue('12')
  await expect(page.getByLabel('Damage to hitpoints')).toHaveValue('500')
})

test('the derived totalDamage field is never written to the URL', async ({ page }) => {
  await page.goto('./boss/zalcano')
  await page.getByLabel('Damage to hitpoints').fill('200')
  await expect(page).toHaveURL(/hpdmg=200/)

  // `withDerivedContext` overwrites totalDamage from its inputs, so encoding it
  // would put a value in a shared link that the model then ignores.
  expect(new URL(page.url()).searchParams.has('totaldmg')).toBe(false)
  expect(page.url()).not.toContain('totalDamage')
})

test('a default run keeps a clean URL', async ({ page }) => {
  await page.goto('./boss/brutus')
  await expect(page.getByRole('heading', { name: 'Brutus' })).toBeVisible()

  // Nothing has been touched, so nothing should have been written.
  expect(new URL(page.url()).search).toBe('')

  // One non-default value writes that value, the seed and the kill count —
  // and nothing else. Fourteen params on a link nobody customised is how a
  // "shareable" URL stops being readable.
  await page.getByLabel('Members').uncheck()
  await expect(page).toHaveURL(/members=0/)
  const params = new URL(page.url()).searchParams
  expect([...params.keys()].sort()).toEqual(['members', 'n', 'seed'])
})

test('set-valued and ownership context round-trip through the URL', async ({ page }) => {
  // `moonsKilled` (comma list) and `ownedCounts` (key:count pairs) are the two
  // encodings with real structure in them, and Lunar Chest is the only source
  // that uses either.
  await page.goto('./boss/lunar-chest?moons=blood,eclipse&owned=blood-moon-helm:1')
  await expect(page.getByRole('heading', { name: 'Lunar Chest' })).toBeVisible()

  await expect(page.getByLabel('Blood Moon')).toBeChecked()
  await expect(page.getByLabel('Eclipse Moon')).toBeChecked()
  await expect(page.getByLabel('Blue Moon')).not.toBeChecked()
  await expect(page.getByLabel('blood-moon-helm')).toHaveValue('1')

  await page.getByLabel('Blue Moon').check()
  await page.getByLabel('eclipse-atlatl').fill('2')

  const params = new URL(page.url()).searchParams
  // MOONS order is canonical (blood, blue, eclipse), not click order.
  expect(params.get('moons')).toBe('blood,blue,eclipse')
  expect(params.get('owned')).toContain('blood-moon-helm:1')
  expect(params.get('owned')).toContain('eclipse-atlatl:2')
})

test('a shared link reproduces the same simulation result', async ({ page }) => {
  // The actual promise of putting the seed in the URL. Same link, same
  // numbers, through a real Worker in a real browser.
  async function runAndRead(url: string): Promise<string> {
    await page.goto(url)
    await expect(page.getByRole('heading', { name: 'Vorkath' })).toBeVisible()
    const simulate = page.getByRole('button', { name: 'Simulate' })
    await expect(simulate).toBeEnabled()
    await simulate.click()
    // Scoped to the results section: the loot table is one modal away now, but
    // scoping still matters — the summary and grid are what vary by seed.
    //
    // Waiting on the SUMMARY rather than the section is the load-bearing part.
    // The section is visible before the click too (it renders an empty state so
    // the layout doesn't jump), so waiting on it would read the empty state
    // back and make "same seed matches" pass for the wrong reason.
    const results = page.getByTestId('results')
    await expect(page.getByTestId('results-summary')).toBeVisible({ timeout: 30_000 })
    return (await results.innerText()).trim()
  }

  const first = await runAndRead('./boss/vorkath?seed=99&n=5000')
  const second = await runAndRead('./boss/vorkath?seed=99&n=5000')
  expect(second).toBe(first)

  const different = await runAndRead('./boss/vorkath?seed=100&n=5000')
  expect(different).not.toBe(first)
})
