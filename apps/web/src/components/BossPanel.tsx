import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { Boss, StatusTier, Table } from '@osrs-loot-simulator/loot-model'
import { bossImageUrl } from '../lib/wiki-images'
import type { SimRunParams } from '../lib/url-state'
import { DropTableView } from './DropTableView'
import { Modal } from './Modal'
import { SimContextControls } from './SimContextControls'
import { StatusBadge } from './StatusBadge'

/**
 * Everything needed to start a simulation, and nothing else.
 *
 * Deliberately not a stat block: no drop count, no expected value, no "rarest
 * drop" summary. The wiki does reference material better and this panel's only
 * job is getting someone to a run. The full table is one button away, in a
 * modal, rather than occupying the column it used to.
 *
 * Layout is a flex column with the controls scrolling and the kill count plus
 * Simulate pinned below them, so a source with eleven derived controls (Lunar
 * Chest, Zalcano) does not push the primary action off the bottom of a 1080p
 * viewport.
 */
/** Matches `StatusBadge`'s own tier colors, so the reason box reads as the badge's own explanation, not a separate signal. */
const REASON_BOX_STYLES: Record<Exclude<StatusTier, 'verified'>, string> = {
  minor_gaps: 'border-lime-500/30 bg-lime-500/10 text-lime-300',
  approximate: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  unknown_scaling: 'border-red-500/30 bg-red-500/10 text-red-300',
}

/** `boss.statusTier` is `'verified'`/`null` only for a `needs_review` document with no tier computed yet — falls back to the reddest, most-caution styling rather than guessing a lighter one. */
function reasonBoxStyle(statusTier: StatusTier | null): string {
  return statusTier !== null && statusTier !== 'verified'
    ? REASON_BOX_STYLES[statusTier]
    : REASON_BOX_STYLES.unknown_scaling
}

export function BossPanel({
  boss,
  image,
  sharedTables,
  params,
  onChange,
  onSimulate,
  running,
}: {
  boss: Boss
  image: string | undefined
  sharedTables: ReadonlyMap<string, Table> | undefined
  params: SimRunParams
  onChange: (params: SimRunParams) => void
  onSimulate: () => void
  running: boolean
}) {
  const [tableOpen, setTableOpen] = useState(false)
  const src = bossImageUrl(image, 300)

  return (
    /*
      `h-full` from 900px up is load-bearing, not decoration. Without a height
      to push against, this flex column sizes to its content and the
      `flex-1 overflow-y-auto` controls region has nothing to shrink against —
      so on a short viewport (900x600 was the case that caught it) the panel
      simply overflowed its column and pushed Simulate off-screen entirely.
      Below 900px the panel stacks and should size to its content, so the
      constraint is scoped to the widths that have a fixed-height column.
    */
    <div className="flex min-h-0 flex-col gap-3 min-[900px]:h-full">
      <div className="flex items-start gap-3 min-[900px]:block">
        {/* Fixed aspect box with its own background: the layout is identical
            whether the image loads, 404s, or was never captured. */}
        <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-md border border-neutral-800 bg-neutral-900 min-[900px]:mb-3 min-[900px]:h-40 min-[900px]:w-full">
          {src !== undefined && (
            <img
              src={src}
              alt={boss.name}
              loading="lazy"
              decoding="async"
              className="max-h-full max-w-full object-contain"
              onError={(event) => {
                event.currentTarget.style.visibility = 'hidden'
              }}
            />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-lg font-semibold text-neutral-100">{boss.name}</h1>
            <StatusBadge status={boss.status} statusTier={boss.statusTier} />
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-xs">
            <Link to="/" className="text-muted hover:text-amber-400 hover:underline">
              ← change boss
            </Link>
            <a
              href={`https://oldschool.runescape.wiki/w/${encodeURIComponent(boss.wikiPage.replace(/ /g, '_'))}`}
              target="_blank"
              rel="noreferrer"
              className="text-muted hover:text-amber-400 hover:underline"
            >
              OSRS Wiki ↗
            </a>
          </div>
        </div>
      </div>

      {/*
        `manual_override` gets no banner: it's a hand-authored document that
        passed every deterministic check, a terminal claim of completeness,
        not a caveat. Only `needs_review` (`statusTier` non-null alongside
        it) shows the SPECIFIC reason it hasn't cleared — never the generic
        "rates may be wrong", which is exactly the "may be inaccurate" style
        of hedge this project has refused throughout.
      */}
      {boss.status === 'needs_review' && (
        <p className={`rounded-md border px-2.5 py-1.5 text-xs ${reasonBoxStyle(boss.statusTier)}`}>
          {boss.statusReason ?? "Hasn't cleared every check — rates may be wrong."}
          {/* The admin page is dev-only, so the link is too. Without this guard
              production would render a link to a route that no longer exists,
              which lands on the search page and reads as a broken app.

              `Link`, not a raw <a href="/...">: on GitHub Pages the app is
              served from /osrs-loot-simulator/, so a root-absolute href points
              at a path belonging to a different site. */}
          {import.meta.env.DEV && (
            <>
              {' '}
              See the{' '}
              <Link to={`/admin?slug=${boss.slug}`} className="underline">
                admin page
              </Link>
              .
            </>
          )}
        </p>
      )}

      <button
        type="button"
        onClick={() => setTableOpen(true)}
        className="min-h-11 w-full rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-neutral-300 hover:border-neutral-700 hover:text-neutral-100"
      >
        View loot table
      </button>

      <div className="min-h-0 flex-1 overflow-y-auto min-[900px]:pr-1">
        {sharedTables === undefined ? (
          <p className="text-sm text-muted">Loading shared tables…</p>
        ) : (
          <SimContextControls
            boss={boss}
            // Needed to discover ownership-gated controls: Lunar Chest's
            // per-set duplicate protection lives in its referenced shared
            // tables, not in the boss document.
            sharedTables={sharedTables}
            params={params}
            onChange={onChange}
          />
        )}
      </div>

      {/*
        Pinned to the bottom of the viewport below 600px.

        `fixed`, not `sticky`. Sticky would hold the button only while the boss
        panel itself is on screen, and on a phone the panel stacks ABOVE the
        results — so the moment someone scrolls down to read what dropped, the
        button they need to re-run is gone. "Always reachable" has to mean the
        whole page, which is what fixed gives. `Footer` reserves matching
        bottom padding at this width so the licence attribution is never the
        thing sitting underneath it.

        From 600px up this is an ordinary block again, pinned by the panel's
        own flex layout.
      */}
      <div className="fixed inset-x-0 bottom-0 z-30 shrink-0 space-y-2 border-t border-neutral-800 bg-neutral-950 p-3 min-[600px]:static min-[600px]:border-t min-[600px]:p-0 min-[600px]:pt-3">
        <div className="grid grid-cols-2 gap-2">
          <label className="block text-sm">
            <span className="mb-1 block text-xs text-neutral-400">Kills to simulate</span>
            <input
              type="number"
              min={1}
              max={10_000_000}
              value={params.kills}
              onChange={(e) => onChange({ ...params, kills: Math.max(1, Number(e.target.value) || 1) })}
              className="min-h-11 w-full rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm"
            />
          </label>
          <label className="block text-sm">
            {/* The hint is part of the control, not a tooltip: a bare 0 in a
                seed box reads as a value someone typed, and the whole point is
                that it is a mode. The run's real seed shows in the results
                summary. */}
            <span className="mb-1 block truncate text-xs text-neutral-400">
              Seed <span className="text-muted">(0 = random)</span>
            </span>
            <input
              type="number"
              min={0}
              value={params.seed}
              onChange={(e) => onChange({ ...params, seed: Math.max(0, Number(e.target.value) || 0) })}
              className="min-h-11 w-full rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm"
            />
          </label>
        </div>

        {/*
          No longer disabled while GE prices are in flight. That gate existed
          because an empty price map showed 0 gp everywhere and read as a bug;
          now the results grid falls back to sorting by rarity and says so, so
          blocking the primary action on a third-party fetch buys nothing.
        */}
        <button
          type="button"
          onClick={onSimulate}
          disabled={running || sharedTables === undefined}
          className="min-h-12 w-full rounded-md bg-amber-500 px-4 py-3 text-base font-semibold text-neutral-950 transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {running ? 'Simulating…' : 'Simulate'}
        </button>
      </div>

      {tableOpen && (
        <Modal title={`${boss.name} — loot table`} onClose={() => setTableOpen(false)}>
          <DropTableView tables={boss.tables} />
        </Modal>
      )}
    </div>
  )
}
