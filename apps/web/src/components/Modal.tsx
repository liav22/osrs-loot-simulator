import { useEffect, useRef, type ReactNode } from 'react'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * A dialog with the three behaviours a modal has to get right: escape and
 * backdrop close it, focus is trapped inside while it is open and returns to
 * whatever opened it, and the page behind does not scroll.
 *
 * Body scroll is locked by `overflow: hidden` on <body> for the modal's
 * lifetime. That is belt-and-braces here — the app shell is a fixed-height
 * `100dvh` grid whose regions scroll internally, so the document has nothing
 * to scroll at desktop sizes anyway — but below 900px the shell deliberately
 * lets the page scroll, and there the lock is doing real work.
 *
 * Full-screen below 600px rather than a centred dialog: a centred card with
 * margins on a phone wastes the only axis a drop table needs.
 */
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: ReactNode
}) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    // Focus the panel itself rather than its first control: a drop table modal
    // opens onto content to read, and jumping focus to the close button reads
    // the dialog's title last.
    panelRef.current?.focus()

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
        return
      }
      if (event.key !== 'Tab') return

      const panel = panelRef.current
      if (panel === null) return
      const focusable = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (element) => element.offsetParent !== null || element === panel
      )
      if (focusable.length === 0) {
        event.preventDefault()
        panel.focus()
        return
      }
      const first = focusable[0]!
      const last = focusable[focusable.length - 1]!
      const active = document.activeElement
      // Wrap in both directions, and catch the case where focus is on the
      // panel itself (where neither branch below would otherwise fire).
      if (event.shiftKey && (active === first || active === panel)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      document.body.style.overflow = previousOverflow
      opener?.focus()
    }
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-neutral-950/80 p-0 sm:p-6"
      onClick={onClose}
      data-testid="modal-backdrop"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        className="flex h-full w-full flex-col border-neutral-800 bg-neutral-950 outline-none sm:h-auto sm:max-h-[80dvh] sm:max-w-3xl sm:rounded-lg sm:border"
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-neutral-800 px-4 py-3">
          <h2 className="text-sm font-semibold text-neutral-200">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-11 w-11 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-900 hover:text-neutral-100"
          >
            ✕
          </button>
        </div>
        {/* The scroll container the spec asks for: the body scrolls, the page does not. */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">{children}</div>
      </div>
    </div>
  )
}
