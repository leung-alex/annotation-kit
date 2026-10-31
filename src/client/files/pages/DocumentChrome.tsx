import { useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { Trash } from '../../../ui/icons.tsx'
import { useInteractiveWindowRegion } from '../../../ui/regions.tsx'
import type { PropsLocale } from '../../../host-contracts.ts'
import css from './PageSelectionAction.module.css'

type Translate = PropsLocale<'annotations'>['t']
export function RequestIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
    <path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M3 16v3a2 2 0 0 0 2 2h3M14 10l7 5-4 1-1 5z" />
  </svg>
}
export function CommentEditor({ t, style, input, comment, setComment, busy, saved, direct, save, cancel, remove, optional = false }: {
  t: Translate; style: CSSProperties; input: RefObject<HTMLTextAreaElement>; comment: string; setComment: (value: string) => void
  busy: boolean; saved: boolean; direct?: boolean; save: () => void; cancel: () => void; remove: () => void
  optional?: boolean
}) {
  const interactiveWindowRegion = useInteractiveWindowRegion()
  useLayoutEffect(() => { input.current?.focus() }, [])
  useLayoutEffect(() => {
    if (!input.current) return
    input.current.style.height = '24px'
    input.current.style.height = `${Math.min(144, input.current.scrollHeight)}px`
  }, [comment])
  return <form {...interactiveWindowRegion} className={`${css.comment} ${saved ? css.expanded : ''}`} style={style} data-page-comment
    onSubmit={e => { e.preventDefault(); save() }}>
    <div className={css.row}><textarea ref={input} rows={1} maxLength={8192} value={comment} disabled={busy}
      aria-label={t(optional ? 'response.placeholder' : direct ? 'page.changes' : 'page.placeholder')} placeholder={t(optional ? 'response.placeholder' : direct ? 'page.changes' : 'page.placeholder')}
      onChange={e => setComment(e.target.value)}
      onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) { e.preventDefault(); save() } }} />
      {!saved && (!optional || comment.length > 0) && <button type="submit" className={css.confirm} aria-label={t(optional ? 'response.save' : direct ? 'page.submit' : 'page.comment')} disabled={busy || !comment.trim()}>
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7"><path d={direct ? 'M10 16V4m-5 5 5-5 5 5' : 'm5 10 3 3 7-8'} /></svg>
      </button>}
    </div>
    {saved && <div className={css.actions}>
      <button type="button" className={css.delete} aria-label={t('page.delete')} disabled={busy} onClick={remove}><Trash width={18} height={18} /></button>
      <button type="button" disabled={busy} onClick={cancel}>{t('page.cancel')}</button>
      <button type="submit" className={css.save} disabled={busy || (!optional && !comment.trim())}>{t('page.save')}</button>
    </div>}
  </form>
}

export function BatchControls({ t, bounds, count, busy, sendDisabled, cancel, send, review }: {
  t: Translate; bounds: DOMRect; count: number; busy: boolean; sendDisabled: boolean; cancel: () => void; send: () => void
  review?: () => void
}) {
  const interactiveWindowRegion = useInteractiveWindowRegion()
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const bar = useRef<HTMLDivElement>(null)
  const drag = useRef<{ pointer: number; x: number; y: number; offset: typeof offset }>()
  const room = Math.max(0, (bounds.width - (bar.current?.offsetWidth ?? 320)) / 2 - 12)
  return <div {...interactiveWindowRegion} ref={bar} className={css.batch} style={{ left: bounds.left + bounds.width / 2 + Math.max(-room, Math.min(room, offset.x)),
    top: bounds.bottom - 52 + Math.max(100 - bounds.height, Math.min(0, offset.y)), maxWidth: bounds.width - 24 }} data-page-batch>
    <span className={css.grip} aria-hidden="true" onPointerDown={e => {
      if (e.button !== 0) return
      e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId)
      drag.current = { pointer: e.pointerId, x: e.clientX, y: e.clientY, offset }
    }} onPointerMove={e => {
      const start = drag.current
      if (!start || start.pointer !== e.pointerId) return
      setOffset({ x: Math.max(-room, Math.min(room, start.offset.x + e.clientX - start.x)),
        y: Math.max(100 - bounds.height, Math.min(0, start.offset.y + e.clientY - start.y)) })
    }} onPointerUp={() => { drag.current = undefined }} onLostPointerCapture={() => { drag.current = undefined }}>⠿</span>
    {review && count ? <button type="button" className={css.count} onClick={review}>{count} {t(count === 1 ? 'page.one' : 'page.many')}</button>
      : <span className={css.count}>{count ? `${count} ${t(count === 1 ? 'page.one' : 'page.many')}` : t('page.pick')}</span>}
    <button type="button" disabled={busy} onClick={cancel}>{t('page.cancel')}</button>
    {!!count && <button type="button" className={css.send} disabled={busy || sendDisabled} onClick={send}>{t(busy ? 'page.sending' : 'page.send')}</button>}
  </div>
}
