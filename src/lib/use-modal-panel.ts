import { useEffect, useRef } from 'react'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Dialog behaviour for a panel that stays mounted: Escape to dismiss, focus
 * moved in on open and restored on close.
 *
 * The drawers in this app are translated off-screen rather than unmounted, so
 * before this their ten controls sat in the tab order of every page and screen
 * readers announced all of them as available. Pair this with `inert={!open}`
 * on the panel — that is what actually takes the hidden controls out of the
 * tab order and the accessibility tree.
 */
export function useModalPanel<T extends HTMLElement>(open: boolean, onClose: () => void) {
  const ref = useRef<T>(null)
  const restoreTo = useRef<HTMLElement | null>(null)
  const onCloseRef = useRef(onClose)

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    if (!open) return

    restoreTo.current = document.activeElement as HTMLElement | null
    // Let the open transition start before pulling focus, or the browser
    // scrolls the still-off-screen panel into view.
    const focusTimer = window.setTimeout(() => {
      ref.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus()
    }, 0)

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current()
    }
    document.addEventListener('keydown', onKeyDown)

    return () => {
      window.clearTimeout(focusTimer)
      document.removeEventListener('keydown', onKeyDown)
      restoreTo.current?.focus?.()
    }
  }, [open])

  return ref
}
