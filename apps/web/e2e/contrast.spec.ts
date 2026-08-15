import { expect, test } from './fixtures'

/**
 * Contrast measured from what the browser actually PAINTS.
 *
 * `test/contrast.test.ts` computes the same ratios from Tailwind's published
 * palette, which proves the colours were chosen correctly. It cannot prove
 * they are the colours on screen: a typo'd utility class, a token Tailwind
 * never generated, or a later rule winning the cascade all leave that unit
 * test perfectly green. This reads `getComputedStyle` off the real elements in
 * the production build, walks up for the first non-transparent background the
 * text is actually painted on, and does the WCAG arithmetic on those values.
 *
 * That distinction is the same one landmine #10 records: a jsdom test that
 * constructs an input the real app fetches is testing a different program.
 */

const AA = 4.5

/** The element's own colour, and the first opaque background painted behind it. */
async function measure(
  page: import('@playwright/test').Page,
  selector: string
): Promise<{ color: string; background: string }> {
  const measured = await page.evaluate((sel) => {
    const element = document.querySelector(sel)
    if (element === null) return null
    let node: Element | null = element
    let background = 'rgba(0, 0, 0, 0)'
    while (node !== null) {
      const value = getComputedStyle(node).backgroundColor
      // Opaque enough to be what the text is read against. `transparent`
      // serialises as `rgba(0, 0, 0, 0)`; a colour with no alpha component at
      // all is fully opaque.
      const alpha = /\/\s*([\d.]+)\s*\)/.exec(value) ?? /rgba?\([^)]*,\s*([\d.]+)\s*\)/.exec(value)
      if (value !== 'transparent' && (alpha === null || Number(alpha[1]) > 0)) {
        background = value
        break
      }
      node = node.parentElement
    }
    return { color: getComputedStyle(element).color, background }
  }, selector)

  expect(measured, `no element matched ${selector}`).not.toBeNull()
  return measured as { color: string; background: string }
}

/**
 * WCAG relative luminance from whatever form the browser reports.
 *
 * Chromium serialises a colour authored in OKLCH as `oklch(0.708 0 none)`
 * rather than converting it to `rgb()`, so an rgb-only parser silently yields
 * NaN — and `expect(NaN).toBeGreaterThanOrEqual(4.5)` fails in a way that
 * looks like a contrast problem instead of a parsing one. Both forms are
 * handled; anything else throws rather than returning a number nobody checked.
 */
function luminance(cssColor: string): number {
  const oklch = /^oklch\(\s*([\d.]+%?)\s+([\d.]+|none)\s+([\d.]+|none)/i.exec(cssColor)
  if (oklch !== null) {
    const [, rawL = '0', rawC = '0', rawH = '0'] = oklch
    const l = rawL.endsWith('%') ? Number(rawL.slice(0, -1)) / 100 : Number(rawL)
    const c = rawC === 'none' ? 0 : Number(rawC)
    const h = ((rawH === 'none' ? 0 : Number(rawH)) * Math.PI) / 180
    const a = c * Math.cos(h)
    const b = c * Math.sin(h)
    const lCube = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3
    const mCube = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3
    const sCube = (l - 0.0894841775 * a - 1.291485548 * b) ** 3
    const clamp = (x: number): number => Math.min(1, Math.max(0, x))
    return (
      0.2126 * clamp(4.0767416621 * lCube - 3.3077115913 * mCube + 0.2309699292 * sCube) +
      0.7152 * clamp(-1.2684380046 * lCube + 2.6097574011 * mCube - 0.3413193965 * sCube) +
      0.0722 * clamp(-0.0041960863 * lCube - 0.7034186147 * mCube + 1.707614701 * sCube)
    )
  }

  const rgb = /^rgba?\(/i.test(cssColor) ? cssColor.match(/[\d.]+/g) : null
  if (rgb === null) throw new Error(`unparseable colour: ${cssColor}`)
  const [r, g, b] = rgb.slice(0, 3).map((v) => {
    const channel = Number(v) / 255
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(foreground: string, background: string): number {
  const [hi, lo] = [luminance(foreground), luminance(background)].sort((a, b) => b - a) as [
    number,
    number,
  ]
  return (hi + 0.05) / (lo + 0.05)
}

test('header and footer text clear WCAG AA as painted', async ({ page }) => {
  await page.goto('./')

  for (const [label, selector] of [
    ['header chrome', 'header div'],
    ['footer attribution', 'footer p'],
  ] as const) {
    const { color, background } = await measure(page, selector)
    const ratio = contrast(color, background)
    // The message carries the numbers, so a failure reports the measurement
    // rather than just "expected false to be true".
    expect(
      ratio,
      `${label}: ${color} on ${background} = ${ratio.toFixed(2)}:1`
    ).toBeGreaterThanOrEqual(AA)
  }
})

test('the header sits on a lifted background, not the body colour', async ({ page }) => {
  await page.goto('./')
  const colors = await page.evaluate(() => ({
    header: getComputedStyle(document.querySelector('header') as Element).backgroundColor,
    body: getComputedStyle(document.body).backgroundColor,
  }))

  expect(colors.header).not.toBe(colors.body)
  // Lifted, not inverted: still unmistakably part of a dark UI.
  expect(luminance(colors.header)).toBeGreaterThan(luminance(colors.body))
  expect(luminance(colors.header)).toBeLessThan(0.1)
})

test('the GitHub link is reachable, labelled, and opens safely', async ({ page }) => {
  await page.goto('./')
  const link = page.getByRole('link', { name: /source code on github/i })

  await expect(link).toBeVisible()
  await expect(link).toHaveAttribute('href', 'https://github.com/liav22/osrs-loot-simulator')
  await expect(link).toHaveAttribute('target', '_blank')
  await expect(link).toHaveAttribute('rel', /(?=.*noopener)(?=.*noreferrer)/)

  // Keyboard-reachable and visibly focusable, since it is icon-only and has no
  // other affordance to fall back on.
  await link.focus()
  await expect(link).toBeFocused()
})
