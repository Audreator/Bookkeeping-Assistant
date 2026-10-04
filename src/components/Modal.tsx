import { useEffect, useRef, type ReactNode } from 'react'

export function Modal({ open = true, onClose, label, sheet = false, children }: {
  open?: boolean
  onClose: () => void
  label: string
  sheet?: boolean
  children: ReactNode
}) {
  const panel = useRef<HTMLDivElement>(null)
  const close = useRef(onClose)
  useEffect(() => { close.current = onClose }, [onClose])

  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const focusable = () => Array.from(panel.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex="0"]',
    ) ?? []).filter((el) => el.getAttribute('type') !== 'hidden' &&
      getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden')
    const initial = panel.current?.querySelector<HTMLElement>('[data-autofocus]') ?? focusable()[0]
    initial?.focus()
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close.current()
      if (event.key !== 'Tab') return
      const elements = focusable()
      const first = elements[0]
      const last = elements[elements.length - 1]
      if (!first) { event.preventDefault(); panel.current?.focus(); return }
      if (event.shiftKey && (document.activeElement === first || !panel.current?.contains(document.activeElement))) {
        event.preventDefault(); last?.focus()
      } else if (!event.shiftKey && (document.activeElement === last || !panel.current?.contains(document.activeElement))) {
        event.preventDefault(); first.focus()
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => {
      document.body.style.overflow = overflow
      document.removeEventListener('keydown', handleKey)
      previous?.focus()
    }
  }, [open])

  if (!open) return null
  return <div className={`modal-backdrop fixed inset-0 z-30 flex justify-center ${sheet ? 'items-end sm:items-center' : 'items-center px-4'}`}
    onClick={(event) => { if (event.target === event.currentTarget) close.current() }}>
    <div ref={panel} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}
      className={`glass-modal w-full overflow-y-auto p-5 ${sheet ? 'glass-sheet max-w-lg' : 'max-w-sm'}`}>
      {children}
    </div>
  </div>
}
