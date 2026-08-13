import type { BossStatus } from '@osrs-loot-simulator/loot-model'

const STYLES: Record<BossStatus, string> = {
  verified: 'bg-emerald-500/15 text-emerald-400 ring-emerald-500/30',
  needs_review: 'bg-amber-500/15 text-amber-400 ring-amber-500/30',
  manual_override: 'bg-sky-500/15 text-sky-400 ring-sky-500/30',
}

const LABELS: Record<BossStatus, string> = {
  verified: 'Verified',
  needs_review: 'Needs review',
  manual_override: 'Manual override',
}

export function StatusBadge({ status }: { status: BossStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STYLES[status]}`}>
      {LABELS[status]}
    </span>
  )
}
