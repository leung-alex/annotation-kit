import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Chat, X } from '../../ui/icons.tsx'
import css from '../files/SelectionCard.module.css'

/** Shared compact attachment/disclosure behavior for immutable reference snapshots. */
export function ReferenceCard({ label, children, draft = false, initiallyOpen = false, onClear, clearLabel, kind }: {
  readonly label: string
  readonly children: ReactNode | (() => ReactNode)
  readonly draft?: boolean
  readonly initiallyOpen?: boolean
  readonly onClear?: () => void
  readonly clearLabel: string
  readonly kind: 'file' | 'response'
}) {
  const [pinned, setPinned] = useState(initiallyOpen)
  const [hovered, setHovered] = useState(false)
  const host = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout>>()
  const panelId = useId()
  const open = pinned || hovered
  useEffect(() => () => clearTimeout(closeTimer.current), [])
  useLayoutEffect(() => {
    const node = host.current
    if (!draft || !open || !node) return
    const measure = () => {
      let top = 0
      for (let parent = node.parentElement; parent; parent = parent.parentElement) {
        if (/(auto|scroll|hidden|clip)/u.test(getComputedStyle(parent).overflowY)) top = Math.max(top, parent.getBoundingClientRect().top)
      }
      node.style.setProperty('--file-selection-space', `${Math.max(80, node.getBoundingClientRect().top - top - 8)}px`)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node.closest('[data-composer-card]') ?? node)
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true) }
  }, [draft, open])
  useEffect(() => {
    if (!open) return
    const close = () => { setPinned(false); setHovered(false); clearTimeout(closeTimer.current) }
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !host.current?.contains(event.target)) close() }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing) return
      if (host.current?.contains(document.activeElement)) trigger.current?.focus()
      close()
    }
    window.addEventListener('pointerdown', outside)
    window.addEventListener('keydown', escape)
    return () => { window.removeEventListener('pointerdown', outside); window.removeEventListener('keydown', escape) }
  }, [open])
  return <div ref={host} className={draft ? css.draft : css.sent}
    data-file-selection-card={kind === 'file' ? (draft ? 'draft' : 'sent') : undefined}
    data-response-annotation-card={kind === 'response' ? (draft ? 'draft' : 'sent') : undefined}
    onPointerEnter={() => { if (draft) { clearTimeout(closeTimer.current); setHovered(true) } }}
    onPointerLeave={() => { closeTimer.current = setTimeout(() => setHovered(false), 160) }}>
    <div className={css.chip}>
      <button ref={trigger} type="button" className={css.summary} aria-expanded={open} aria-controls={panelId}
        onClick={() => { setPinned(!pinned); setHovered(false) }}><Chat width={16} height={16} /><span>{label}</span></button>
      {onClear && <button type="button" className={css.removeAll} aria-label={clearLabel} onClick={onClear}><X width={14} height={14} /></button>}
    </div>
    {open && <section id={panelId} className={draft ? css.popover : css.details} aria-label={label}
      onFocusCapture={() => setPinned(true)}>{typeof children === 'function' ? children() : children}</section>}
  </div>
}
