/**
 * PROJECT_PLAN.md 10: "A visible attribution line in the site footer
 * linking to the OSRS Wiki, plus the Jagex trademark acknowledgement" — the
 * licensing section is not optional, and this is one of its deliverables.
 */
export function Footer() {
  return (
    <footer className="mx-auto max-w-5xl px-4 py-8 text-xs text-neutral-600">
      <p>
        Drop table data is derived from the{' '}
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
        . Old School RuneScape is a trademark of Jagex Ltd. This is an unofficial fan project, not affiliated with
        or endorsed by Jagex.
      </p>
    </footer>
  )
}
