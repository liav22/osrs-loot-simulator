import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * WCAG contrast, computed rather than eyeballed.
 *
 * The header and footer shipped `text-neutral-600` on the `neutral-950` body
 * at **2.54:1** — barely legible — and the shared muted-foreground colour was
 * `text-neutral-500`, which reaches only 4.18:1 on the body and 3.79:1 on a
 * panel. Both are below AA's 4.5:1 for body text, and the second was wrong in
 * 27 places, not two.
 *
 * These assertions are the wire that stops either coming back. They are
 * deliberately computed from the palette rather than compared against stored
 * numbers, so a Tailwind palette change is caught too — the v4 neutral scale
 * has already been recalibrated once relative to v3.
 */

/** Tailwind v4 palette entries this UI uses, as published `oklch(l c h)`. */
const PALETTE = {
  'neutral-100': [0.97, 0, 0],
  'neutral-300': [0.87, 0, 0],
  'neutral-400': [0.708, 0, 0],
  'neutral-500': [0.556, 0, 0],
  'neutral-600': [0.439, 0, 0],
  'neutral-800': [0.269, 0, 0],
  'neutral-900': [0.205, 0, 0],
  'neutral-950': [0.145, 0, 0],
  'emerald-400': [0.765, 0.177, 163.223],
  'emerald-500': [0.696, 0.17, 162.48],
  'amber-400': [0.828, 0.189, 84.429],
  'amber-500': [0.769, 0.188, 70.08],
  'sky-300': [0.828, 0.111, 230.318],
  'sky-400': [0.746, 0.16, 232.661],
  'sky-500': [0.685, 0.169, 237.323],
} as const satisfies Record<string, readonly [number, number, number]>

type Token = keyof typeof PALETTE
type Linear = [number, number, number]

/** OKLCH -> linear sRGB (Björn Ottosson's matrices), clamped to gamut. */
function toLinear(token: Token): Linear {
  const [l, c, hDeg] = PALETTE[token]
  const h = (hDeg * Math.PI) / 180
  const a = c * Math.cos(h)
  const b = c * Math.sin(h)
  const lCube = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const mCube = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const sCube = (l - 0.0894841775 * a - 1.291485548 * b) ** 3
  const clamp = (x: number): number => Math.min(1, Math.max(0, x))
  return [
    clamp(4.0767416621 * lCube - 3.3077115913 * mCube + 0.2309699292 * sCube),
    clamp(-1.2684380046 * lCube + 2.6097574011 * mCube - 0.3413193965 * sCube),
    clamp(-0.0041960863 * lCube - 0.7034186147 * mCube + 1.707614701 * sCube),
  ]
}

const luminance = ([r, g, b]: Linear): number => 0.2126 * r + 0.7152 * g + 0.0722 * b

/** Alpha compositing is done in LINEAR light, which is where the blend really happens. */
const composite = (fg: Linear, bg: Linear, alpha: number): Linear =>
  [0, 1, 2].map((i) => (fg[i] ?? 0) * alpha + (bg[i] ?? 0) * (1 - alpha)) as Linear

function contrast(fg: Linear, bg: Linear): number {
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((a, b) => b - a) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

const ratio = (fg: Token, bg: Token): number => contrast(toLinear(fg), toLinear(bg))

/** WCAG 2.1 AA for body text. Large text (1.5.3) would be 3:1; nothing here relies on that. */
const AA = 4.5

/** Every background the app paints text on. */
const BACKGROUNDS = ['neutral-950', 'neutral-900', 'neutral-800'] as const

describe('the colour model itself', () => {
  it('reproduces Tailwind’s own published sRGB values', () => {
    // Guards the maths, not the design: if this drifts, every ratio below is
    // meaningless. Tailwind documents these neutrals as #0a0a0a … #f5f5f5.
    const hex = (token: Token): string => {
      const y = luminance(toLinear(token))
      const encoded = y <= 0.0031308 ? 12.92 * y : 1.055 * y ** (1 / 2.4) - 0.055
      const v = Math.round(encoded * 255)
      return `#${[v, v, v].map((x) => x.toString(16).padStart(2, '0')).join('')}`
    }
    expect(hex('neutral-950')).toBe('#0a0a0a')
    expect(hex('neutral-900')).toBe('#171717')
    expect(hex('neutral-800')).toBe('#262626')
    expect(hex('neutral-500')).toBe('#737373')
    expect(hex('neutral-400')).toBe('#a1a1a1')
    expect(hex('neutral-100')).toBe('#f5f5f5')
  })
})

describe('the muted-foreground token', () => {
  it('clears AA on every background the app uses', () => {
    for (const background of BACKGROUNDS) {
      const value = ratio('neutral-400', background)
      expect(value, `muted on ${background} is ${value.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA)
    }
  })

  it('records why neutral-500 could not simply be kept', () => {
    // Not a style preference: 500 fails AA against every background in this
    // UI, so there was no "use it only on the darkest surface" escape.
    for (const background of BACKGROUNDS) {
      expect(ratio('neutral-500', background)).toBeLessThan(AA)
    }
    // And the header/footer's original colour was far worse than that.
    expect(ratio('neutral-600', 'neutral-950')).toBeLessThan(3)
  })
})

describe('header and footer chrome', () => {
  it('clears AA for body text and for its links, on the lifted background', () => {
    expect(ratio('neutral-400', 'neutral-900')).toBeGreaterThanOrEqual(AA) // muted body text
    expect(ratio('neutral-100', 'neutral-900')).toBeGreaterThanOrEqual(AA) // title, link hover
    expect(ratio('amber-400', 'neutral-900')).toBeGreaterThanOrEqual(AA) // accent hover
  })

  it('keeps the lift subtle enough to still read as one surface family', () => {
    // A "slight" lift, quantified: distinguishable from the body, nowhere near
    // the separation of a real content panel.
    const lift = ratio('neutral-900', 'neutral-950')
    expect(lift).toBeGreaterThan(1.1)
    expect(lift).toBeLessThan(1.5)
  })
})

describe('status badges', () => {
  // Each badge is a 400/300-weight foreground over a 15% tint of its own 500
  // composited on the surface behind it.
  const badge = (fg: Token, tint: Token, surface: Token): number =>
    contrast(toLinear(fg), composite(toLinear(tint), toLinear(surface), 0.15))

  it('clear AA on both the panel and the body background', () => {
    for (const surface of ['neutral-900', 'neutral-950'] as const) {
      expect(badge('emerald-400', 'emerald-500', surface)).toBeGreaterThanOrEqual(AA)
      expect(badge('amber-400', 'amber-500', surface)).toBeGreaterThanOrEqual(AA)
      expect(badge('sky-300', 'sky-500', surface)).toBeGreaterThanOrEqual(AA)
    }
  })

  it('pins why manual_override uses sky-300 and not sky-400 like its siblings', () => {
    // The one badge that failed, and only on a panel — 4.46:1, close enough to
    // pass a glance and not a calculation. Left as an assertion so a future
    // "make the badges consistent" edit has to argue with a number.
    expect(badge('sky-400', 'sky-500', 'neutral-900')).toBeLessThan(AA)
    expect(badge('sky-300', 'sky-500', 'neutral-900')).toBeGreaterThanOrEqual(AA)
  })
})

describe('the rarest-item card, whose amber tint lifts its own background', () => {
  // `bg-amber-500/10` over the results panel (`bg-neutral-950`).
  const tinted = composite(toLinear('amber-500'), toLinear('neutral-950'), 0.1)

  it('needs one step lighter than the muted token, which is why it overrides it', () => {
    // The reason `SimResultsView` special-cases this card. Worth an assertion
    // because the override looks arbitrary next to every other muted use, and
    // a tidy-up would delete it.
    expect(contrast(toLinear('neutral-400'), tinted)).toBeLessThan(AA)
    expect(contrast(toLinear('neutral-300'), tinted)).toBeGreaterThanOrEqual(AA)
  })

  it('was far worse before, which no one had measured', () => {
    // The old muted colour on this card: 2.29:1.
    expect(contrast(toLinear('neutral-500'), tinted)).toBeLessThan(3)
  })

  it('keeps the item name itself well clear', () => {
    expect(contrast(toLinear('neutral-100'), tinted)).toBeGreaterThanOrEqual(AA)
  })
})

describe('the source tree', () => {
  const sourceFiles = (dir: string): string[] =>
    readdirSync(dir).flatMap((entry) => {
      const path = join(dir, entry)
      if (statSync(path).isDirectory()) return sourceFiles(path)
      return /\.(tsx?|css)$/.test(entry) ? [path] : []
    })

  it('has no remaining use of the two shades that fail AA', () => {
    // The trip wire. Every use was migrated to `text-muted`; this is what
    // stops one drifting back in, which a per-component review would miss.
    const offenders = sourceFiles(join(import.meta.dirname, '..', 'src'))
      .filter((path) => /\btext-neutral-(500|600)\b/.test(readFileSync(path, 'utf8')))
      .map((path) => path.split('/src/')[1])
    expect(offenders).toEqual([])
  })

  it('defines the muted token once, in the stylesheet', () => {
    const css = readFileSync(join(import.meta.dirname, '..', 'src', 'index.css'), 'utf8')
    expect(css).toMatch(/--color-muted:\s*oklch\(70\.8% 0 none\)/)
  })
})
