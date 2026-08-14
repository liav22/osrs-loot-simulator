import { expect, test } from './fixtures'

/**
 * The per-boss derived control set, in a real browser against the production
 * build. `test/SimContextControls.test.tsx` already asserts the same thing in
 * jsdom, and that test is not redundant — but it hands the component a
 * `sharedTables` map built by `readdirSync`-ing `data/tables/`, which is not
 * how the browser gets that map. The browser fetches it, over the network,
 * from whatever list `lib/api.ts` decides to ask for. Anything that list
 * misses is invisible to jsdom and fatal in production, so these assertions
 * run through the real fetch path end to end.
 */

test('Doom of Mokhaiotl gets a delve level control and nothing it does not read', async ({ page }) => {
  await page.goto('./boss/doom-of-mokhaiotl')
  await expect(page.getByRole('heading', { name: 'Doom of Mokhaiotl' })).toBeVisible()

  await expect(page.getByLabel('Delve level reached')).toBeVisible()
  await expect(page.getByLabel('Damage to shield')).toBeHidden()
  await expect(page.getByLabel('Fishing level')).toBeHidden()
})

test('Zalcano gets both damage inputs and the MVP toggle, and no totalDamage control', async ({ page }) => {
  await page.goto('./boss/zalcano')
  await expect(page.getByRole('heading', { name: 'Zalcano' })).toBeVisible()

  await expect(page.getByLabel('Damage to hitpoints')).toBeVisible()
  await expect(page.getByLabel('Damage to shield')).toBeVisible()
  // `isMVP` appears in zero conditions in Zalcano's document — it is read only
  // inside zalcano_mvp_share/zalcano_mvp_only. Its presence here is the whole
  // FORMULA_CONTEXT_FIELDS mechanism working through a real render.
  await expect(page.getByLabel('MVP (most damage dealt)')).toBeVisible()

  // `totalDamage` is derived and overwritten by `withDerivedContext`, so a
  // control for it would be a control that does nothing.
  await expect(page.getByLabel(/total damage/i)).toHaveCount(0)
})

test('Lunar Chest gets its Moon selector AND its ownership controls', async ({ page }) => {
  await page.goto('./boss/lunar-chest')
  await expect(page.getByRole('heading', { name: 'Lunar Chest' })).toBeVisible()

  await expect(page.getByLabel('Blood Moon')).toBeVisible()
  await expect(page.getByLabel('Blue Moon')).toBeVisible()
  await expect(page.getByLabel('Eclipse Moon')).toBeVisible()

  // The sharp one. Lunar Chest's `ownershipGate`s live entirely inside the
  // three `lunar_chest_*_set` shared tables, so these controls exist only if
  // the browser actually fetched those records and `contextSurfaceOf` could
  // follow the tableRefs into them.
  await expect(page.getByText(/Already owned entering the run/)).toBeVisible()
  await expect(page.getByLabel('blood-moon-helm')).toBeVisible()
  await expect(page.getByLabel('eclipse-atlatl')).toBeVisible()
})

test('Reward pool gets a Fishing level control and simulates through its bracket table', async ({
  page,
}) => {
  // The newest source, and the first whose controls come from a two-sided
  // `levelAtLeast` bracket. It also exercises the shared-table manifest end to
  // end: its fish sub-table is a `tableRef` into `reward_pool_fish`, a record
  // that did not exist when the browser's table list was last hardcoded.
  await page.goto('./boss/reward-pool?fishing=81&n=500&seed=5')
  await expect(page.getByRole('heading', { name: 'Reward pool' })).toBeVisible()

  await expect(page.getByLabel('Fishing level')).toHaveValue('81')
  await expect(page.getByLabel('Delve level reached')).toBeHidden()

  const simulate = page.getByRole('button', { name: 'Simulate' })
  await expect(simulate).toBeEnabled()
  await simulate.click()
  await expect(page.getByRole('heading', { name: 'Results' })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(/Simulation failed/)).toHaveCount(0)
})

test('Brutus gets none of the extension fields', async ({ page }) => {
  await page.goto('./boss/brutus')
  await expect(page.getByRole('heading', { name: 'Brutus' })).toBeVisible()

  // The negative case matters as much as the positives: rendering all sixteen
  // fields on every boss would bury the two that matter.
  await expect(page.getByLabel('Members')).toBeVisible()
  await expect(page.getByLabel('Delve level reached')).toBeHidden()
  await expect(page.getByLabel('MVP (most damage dealt)')).toBeHidden()
  await expect(page.getByText(/Already owned entering the run/)).toBeHidden()
})

test('Lunar Chest simulates with a Moon selected, rather than failing on an unresolved tableRef', async ({
  page,
}) => {
  // `expectedValue` is wrapped in a try/catch in BossView, so an unresolved
  // tableRef degrades silently there. The worker has no such catch: it reports
  // the throw as "Simulation failed".
  //
  // `moons=blood` is not incidental — it is the whole test. The three
  // `lunar_chest_*_set` tableRefs sit behind an `includes` condition on
  // `moonsKilled`, so with the default empty set `compileTable` filters those
  // entries out and never resolves the refs. A run with no Moon selected
  // therefore succeeds even when the shared tables are missing entirely, which
  // is exactly how this shipped broken. Selecting a Moon is what makes the
  // reference reachable, and it is also the only configuration in which Lunar
  // Chest's mechanic exists at all.
  await page.goto('./boss/lunar-chest?moons=blood&n=200&seed=3')
  await expect(page.getByRole('heading', { name: 'Lunar Chest' })).toBeVisible()
  await expect(page.getByLabel('Blood Moon')).toBeChecked()

  const simulate = page.getByRole('button', { name: 'Simulate' })
  await expect(simulate).toBeEnabled()
  await simulate.click()

  await expect(page.getByRole('heading', { name: 'Results' })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(/Simulation failed/)).toHaveCount(0)
})
