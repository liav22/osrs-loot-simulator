import { expect, resultProjection, test } from './fixtures'

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
  await page.goto('./boss/zalcano?mvp=1&hpdmg=500&shielddmg=40&seed=7&n=1234')
  await expect(page.getByRole('heading', { name: 'Zalcano' })).toBeVisible()

  await expect(page.getByLabel('MVP (most damage dealt)')).toBeChecked()
  await expect(page.getByLabel('Damage to hitpoints')).toHaveValue('500')
  await expect(page.getByLabel('Damage to shield')).toHaveValue('40')
  await expect(page.getByLabel('Seed')).toHaveValue('7')
  await expect(page.getByLabel('Kills to simulate')).toHaveValue('1234')
})

test('a Konar task deep link populates the control, only on a Konar-eligible boss', async ({ page }) => {
  // Zalcano is not Konar-eligible (no Brimstone key on its table), so the
  // control renders on neither page unless the boss's own document uses
  // `onKonarTask` — Scorpia does. See `SimContextControls.test.tsx`'s
  // surface-discovery tests for the positive/negative pair at the unit level.
  await page.goto('./boss/scorpia?konar=1')
  await expect(page.getByRole('heading', { name: 'Scorpia' })).toBeVisible()
  await expect(page.getByLabel('Konar task')).toBeChecked()

  await page.goto('./boss/zalcano')
  await expect(page.getByRole('heading', { name: 'Zalcano' })).toBeVisible()
  await expect(page.getByLabel('Konar task')).toHaveCount(0)
})

test('an Awakened deep link populates the control, only on a DT2 boss with the ornament kit gate', async ({
  page,
}) => {
  await page.goto('./boss/vardorvis?awakened=1')
  await expect(page.getByRole('heading', { name: 'Vardorvis' })).toBeVisible()
  await expect(page.getByLabel('Awakened (last of the four)')).toBeChecked()

  await page.goto('./boss/zalcano')
  await expect(page.getByRole('heading', { name: 'Zalcano' })).toBeVisible()
  await expect(page.getByLabel('Awakened (last of the four)')).toHaveCount(0)
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
  // Brutus is the one source with a real free-to-play table, so it is the one
  // that renders this control. Checking it sets `members: false`, which is
  // still what the URL carries — the param is unchanged by the control being
  // inverted, so links shared before this change still reproduce.
  await page.getByLabel('Free-to-play').check()
  await expect(page).toHaveURL(/members=0/)
  const params = new URL(page.url()).searchParams
  expect([...params.keys()].sort()).toEqual(['members', 'n', 'seed'])
})

/**
 * The members toggle was retired from the per-boss controls, so most sources
 * now render nothing for it. Links shared before that change still carry
 * `members=0`, and they have to keep working — the control was presentation,
 * the context field was not.
 */
test('a members=0 link still applies on a boss that renders no control for it', async ({
  page,
}) => {
  // Black Knight Titan is members-only, so it deliberately gets no
  // free-to-play toggle — the strongest version of this case, since there is
  // no control on the page at all to carry the value.
  await page.goto('./boss/black-knight-titan?members=0&seed=7&n=1000')
  await expect(page.getByRole('heading', { name: 'Black Knight Titan' })).toBeVisible()
  await expect(page.getByLabel('Members')).toHaveCount(0)
  await expect(page.getByLabel('Free-to-play')).toHaveCount(0)

  // The value survives a control-less page rather than being silently dropped
  // back to the default on the first URL write-back.
  await page.getByLabel('Seed').fill('8')
  await expect(page).toHaveURL(/members=0/)
  await page.reload()
  await expect(page).toHaveURL(/members=0/)
})

test('a members=0 link drives the free-to-play control where one exists', async ({ page }) => {
  await page.goto('./boss/brutus?members=0')
  await expect(page.getByRole('heading', { name: 'Brutus' })).toBeVisible()
  // Inverted: members=0 means the F2P box is CHECKED.
  await expect(page.getByLabel('Free-to-play')).toBeChecked()
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
  // Ownership is a toggle chip (real item name, `aria-pressed`), not a number
  // input — every `ownershipGate` in the corpus is "own it or not". See
  // `SimContextControls.test.tsx`'s "ownership controls render as toggleable
  // chips, not number inputs".
  await expect(page.getByRole('button', { name: 'Blood moon helm' })).toHaveAttribute('aria-pressed', 'true')

  await page.getByLabel('Blue Moon').check()
  await page.getByRole('button', { name: 'Eclipse atlatl' }).click()

  const params = new URL(page.url()).searchParams
  // MOONS order is canonical (blood, blue, eclipse), not click order.
  expect(params.get('moons')).toBe('blood,blue,eclipse')
  expect(params.get('owned')).toContain('blood-moon-helm:1')
  expect(params.get('owned')).toContain('eclipse-atlatl:1')
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
    await expect(page.getByTestId('results-summary')).toBeVisible({ timeout: 30_000 })
    return resultProjection(page)
  }

  const first = await runAndRead('./boss/vorkath?seed=99&n=5000')
  const second = await runAndRead('./boss/vorkath?seed=99&n=5000')
  expect(second).toBe(first)

  const different = await runAndRead('./boss/vorkath?seed=100&n=5000')
  expect(different).not.toBe(first)
})
