import { useEffect, useState } from 'react'
import { itemIconUrl } from '../lib/wiki-images'

/**
 * An item's wiki icon.
 *
 * `file` is the resolved file name from `data/item-icons.json`, not the item
 * name — resolution happens in ingest, once, against the wiki's own API. This
 * component used to derive the URL itself and retry through `Special:FilePath`
 * on error; both are gone, because a measured 13.6% of derived URLs 404'd and
 * the retry was a second request per miss against a page that rate-limits.
 * See `lib/wiki-images.ts`.
 *
 * The `onError` path stays. It no longer has a known failure class to catch,
 * but an icon can still fail on a re-upload between ingest runs or a flaky
 * network, and a broken-image glyph is a worse answer than a letter.
 *
 * Size is fixed in CSS and mirrored onto `width`/`height`, so the box reserves
 * its space before anything loads and a failure costs no layout shift.
 */
export function ItemIcon({
  name,
  file,
  size = 32,
}: {
  name: string
  file: string | undefined
  size?: number
}) {
  const [failed, setFailed] = useState(false)
  const src = itemIconUrl(file)

  // Cards are recycled by key as the grid re-sorts; without this a card that
  // had failed would keep showing the placeholder for its new item.
  useEffect(() => setFailed(false), [src])

  if (src === undefined || failed) {
    return (
      <span
        aria-hidden="true"
        style={{ width: size, height: size }}
        className="flex shrink-0 items-center justify-center rounded bg-neutral-800 font-mono text-xs text-muted"
      >
        {name.slice(0, 1).toUpperCase()}
      </span>
    )
  }

  return (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      style={{ width: size, height: size }}
      className="shrink-0 object-contain"
    />
  )
}
