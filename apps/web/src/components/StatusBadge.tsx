import type { BossStatus, StatusTier } from '@osrs-loot-simulator/loot-model'

/**
 * `needs_review` is internal language that lumps together things a user
 * would treat very differently — a single missing edge-case item and a
 * mechanic the wiki never states a formula for. `statusTier` (derived by
 * `apps/ingest/src/tier.ts` from `validation.checks`, never hand-classified)
 * is the user-facing read; `manual_override` stays its own badge, driven by
 * `status` alone, since it is a separate terminal claim of completeness, not
 * a point on this scale.
 */
export type BadgeKind = StatusTier | 'manual_override' | 'needs_review'

const STYLES: Record<BadgeKind, string> = {
  verified: 'bg-emerald-500/15 text-emerald-400 ring-emerald-500/30',
  minor_gaps: 'bg-lime-500/15 text-lime-400 ring-lime-500/30',
  approximate: 'bg-amber-500/15 text-amber-400 ring-amber-500/30',
  unknown_scaling: 'bg-red-500/15 text-red-400 ring-red-500/30',
  manual_override: 'bg-sky-500/15 text-sky-300 ring-sky-500/30',
  needs_review: 'bg-neutral-500/15 text-neutral-400 ring-neutral-500/30',
}

const LABELS: Record<BadgeKind, string> = {
  verified: 'Verified',
  minor_gaps: 'Minor gaps',
  approximate: 'Approximate',
  unknown_scaling: 'Unknown scaling',
  manual_override: 'Manual override',
  needs_review: 'Needs review',
}

/** One-line, user-facing explanation of each badge — shown by `StatusLegend`. */
export const STATUS_DESCRIPTIONS: Record<BadgeKind, string> = {
  verified: "Parsed straight from the wiki and checked automatically, no human judgement involved.",
  minor_gaps: 'Missing a small, documented edge case — a rare item or two, not the core table.',
  approximate: "A known simplification stands in for a mechanic that isn't modelled exactly.",
  unknown_scaling: "Depends on a formula or mechanic the wiki doesn't fully state.",
  manual_override: 'A human supplied or corrected part of the table; every check still passes.',
  needs_review: "Failed a check and hasn't been triaged further yet.",
}

/** Every badge kind, in the order `StatusLegend` renders them. */
export const BADGE_KINDS: readonly BadgeKind[] = [
  'verified',
  'manual_override',
  'minor_gaps',
  'approximate',
  'unknown_scaling',
  'needs_review',
]

function badgeKindOf(status: BossStatus, statusTier: StatusTier | null | undefined): BadgeKind {
  if (status === 'manual_override') return 'manual_override'
  // `statusTier` is `undefined` only for a caller that hasn't wired it up yet
  // (or `null` for a `needs_review` document parsed before this field
  // existed) — the old two-state label is the honest fallback, not a guess.
  return statusTier ?? 'needs_review'
}

/** The bare pill, keyed directly by kind — `StatusBadge` derives `kind` from a boss's own fields; `StatusLegend` already knows it. */
export function BadgePill({ kind }: { kind: BadgeKind }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STYLES[kind]}`}
    >
      {LABELS[kind]}
    </span>
  )
}

export function StatusBadge({
  status,
  statusTier,
}: {
  status: BossStatus
  statusTier?: StatusTier | null
}) {
  return <BadgePill kind={badgeKindOf(status, statusTier)} />
}
