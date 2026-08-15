import { useEffect, useState } from 'react'
import { itemIconFallbackUrl, itemIconUrl } from '../lib/wiki-images'

/**
 * An item's wiki icon, with the two-stage fallback the measured miss rate
 * requires. `lib/wiki-images.ts` carries the numbers and why the order is this
 * way round; the short version is that the direct CDN path is right 86% of the
 * time and `Special:FilePath` recovers most of the rest but rate-limits if it
 * is asked for every icon on the page.
 *
 * Size is fixed in CSS and mirrored onto `width`/`height`, so the box reserves
 * its space before anything loads and a 404 costs no layout shift. The
 * placeholder is the item's first letter rather than a broken-image glyph or a
 * generic box — at 32px it still tells two adjacent cards apart.
 */
export function ItemIcon({ name, size = 32 }: { name: string; size?: number }) {
  const [stage, setStage] = useState<0 | 1 | 2>(0)

  // Cards are recycled by key as the grid re-sorts; without this a card that
  // had failed would keep showing the placeholder for its new item.
  useEffect(() => setStage(0), [name])

  if (stage === 2) {
    return (
      <span
        aria-hidden="true"
        style={{ width: size, height: size }}
        className="flex shrink-0 items-center justify-center rounded bg-neutral-800 font-mono text-xs text-neutral-500"
      >
        {name.slice(0, 1).toUpperCase()}
      </span>
    )
  }

  return (
    <img
      src={stage === 0 ? itemIconUrl(name) : itemIconFallbackUrl(name)}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      onError={() => setStage((s) => (s === 0 ? 1 : 2))}
      style={{ width: size, height: size }}
      className="shrink-0 object-contain"
    />
  )
}
