import { useEffect, useState } from 'react'
import { bossImageUrl } from '../lib/wiki-images'

/**
 * A boss portrait, sized for a small grid tile. Mirrors `ItemIcon`'s
 * always-renders-something design (see that file): a missing or failed
 * image falls back to a single-letter avatar rather than a broken-image
 * glyph or an empty box, so a card never looks like a loading error.
 */
export function BossThumb({ name, image, size = 56 }: { name: string; image: string | undefined; size?: number }) {
  const [failed, setFailed] = useState(false)
  const src = bossImageUrl(image, size * 2)

  useEffect(() => setFailed(false), [src])

  const showLetter = src === undefined || failed

  return (
    <span
      style={{ width: size, height: size }}
      className="flex shrink-0 items-center justify-center overflow-hidden rounded-md bg-neutral-800"
    >
      {showLetter ? (
        <span aria-hidden="true" className="font-mono text-sm text-muted">
          {name.slice(0, 1).toUpperCase()}
        </span>
      ) : (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className="h-full w-full object-contain"
        />
      )}
    </span>
  )
}
