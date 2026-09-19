import type { Boss } from '@osrs-loot-simulator/loot-model'

export interface AttemptLabel {
  singular: string
  plural: string
}

const KILL_LABEL: AttemptLabel = { singular: 'kill', plural: 'kills' }

/** User-facing terminology for one simulation roll; combat sources default to kills. */
export function attemptLabelFor(boss: Boss): AttemptLabel {
  return boss.attemptLabel ?? KILL_LABEL
}

export function capitalizeLabel(label: string): string {
  return label.charAt(0).toUpperCase() + label.slice(1)
}
