import { BADGE_KINDS, BadgePill, STATUS_DESCRIPTIONS } from './StatusBadge'

/**
 * Collapsed by default — a first-time visitor sees `SearchBox` and nothing
 * else, matching `HomePage`'s own "the list is hidden until you need it"
 * design. `<details>` needs no state and is keyboard/screen-reader accessible
 * for free.
 */
export function StatusLegend() {
  return (
    <details className="mt-6 text-xs text-muted">
      <summary className="cursor-pointer select-none hover:text-neutral-300">What do the badges mean?</summary>
      <dl className="mt-2 space-y-1.5">
        {BADGE_KINDS.map((kind) => (
          <div key={kind} className="flex items-baseline gap-2">
            <dt className="shrink-0">
              <BadgePill kind={kind} />
            </dt>
            <dd>{STATUS_DESCRIPTIONS[kind]}</dd>
          </div>
        ))}
      </dl>
    </details>
  )
}
