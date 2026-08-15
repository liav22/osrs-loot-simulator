/**
 * PROJECT_PLAN.md 10: "A visible attribution line in the site footer linking
 * to the OSRS Wiki, plus the Jagex trademark acknowledgement" — the licensing
 * section is not optional, and this is one of its deliverables.
 *
 * Compacted to a single line for the fixed-height shell, not removed: the
 * obligation is that it stays visible, and it does, on every route and at
 * every width.
 *
 * `reserveActionBar` adds bottom padding below 600px, where `BossPanel` pins
 * its Simulate button to the viewport with `position: fixed`. Without it, the
 * one element the licence requires to stay visible is the one element sitting
 * underneath that bar at full scroll. Passed by `App` rather than always on,
 * so the search page doesn't carry 100px of dead space for a bar it never
 * renders.
 */
export function Footer({ reserveActionBar = false }: { reserveActionBar?: boolean }) {
  return (
    <footer
      className={`shrink-0 border-t border-neutral-800 px-4 pt-1.5 text-[11px] leading-snug text-neutral-600 min-[600px]:py-1.5 ${
        reserveActionBar ? 'pb-28' : 'pb-1.5'
      }`}
    >
      <p>
        Drop table data derived from the{' '}
        <a
          href="https://oldschool.runescape.wiki/"
          target="_blank"
          rel="noreferrer"
          className="underline hover:text-neutral-400"
        >
          Old School RuneScape Wiki
        </a>
        , licensed{' '}
        <a
          href="https://creativecommons.org/licenses/by-nc-sa/3.0/"
          target="_blank"
          rel="noreferrer"
          className="underline hover:text-neutral-400"
        >
          CC BY-NC-SA 3.0
        </a>
        . Old School RuneScape is a trademark of Jagex Ltd. Unofficial fan project, not affiliated with or endorsed by
        Jagex.
      </p>
    </footer>
  )
}
