import { annotationErrorText } from './errors.ts'
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { Chat, ChatFilled, X, SettingsSlider, Trash } from '../ui/icons.tsx'
import type { PropsLocale } from '../host-contracts.ts'
import type { BrowserSurfaceHandle } from '../shared/surface.ts'
import type { AnnotationsModel } from './model.ts'
import css from './Annotations.module.css'

export interface AnnotationProps extends PropsLocale<'annotations'> {
  readonly surface: BrowserSurfaceHandle
  readonly model: AnnotationsModel
}

export function AnnotationButton({ surface, model, t }: AnnotationProps) {
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot)
  const active = state.drafts[surface.id]?.active ?? false
  return <button type="button" className={css.annotate} aria-label={t('annotate')} aria-pressed={active}
    disabled={!active && (!model.available(surface) || !model.hasTarget())}
    title={active ? t('close') : t('pick')} onClick={() => { void model.toggle(surface) }}>
    <Chat width={18} height={18} />{t('annotate')}
  </button>
}

/** Trusted renderer overlay: no browser panel, no guest access to the comment. */
export function AnnotationOverlay({ surface, model, t }: AnnotationProps) {
  const state = useSyncExternalStore(model.subscribe, model.getSnapshot)
  const draft = state.drafts[surface.id]
  const selection = draft?.active ? draft.selection : undefined
  const [bounds, setBounds] = useState<DOMRect>()
  const [adjusting, setAdjusting] = useState(false)
  const form = useRef<HTMLFormElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    if (!draft?.active) return
    const viewport = document.getElementById(surface.viewportId)
    if (!viewport) return
    const measure = () => setBounds(viewport.getBoundingClientRect())
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(viewport)
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true) }
  }, [draft?.active, surface.viewportId])
  useEffect(() => {
    setAdjusting(false)
    if (selection) input.current?.focus()
  }, [selection])
  useLayoutEffect(() => {
    if (!input.current) return
    input.current.style.height = '24px'
    input.current.style.height = `${Math.min(144, input.current.scrollHeight)}px`
  }, [draft?.comment, selection])
  useEffect(() => {
    if (!draft?.active) return
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing) return
      event.preventDefault()
      if (selection) model.cancel(surface.id)
      else void model.toggle(surface)
    }
    const outside = (event: PointerEvent) => {
      if (selection && event.target instanceof Node && !form.current?.contains(event.target)) model.cancel(surface.id)
    }
    window.addEventListener('keydown', dismiss)
    window.addEventListener('pointerdown', outside)
    return () => { window.removeEventListener('keydown', dismiss); window.removeEventListener('pointerdown', outside) }
  }, [draft?.active, selection, surface, model])
  if (!draft?.active || !bounds || bounds.width < 1 || bounds.height < 1) return null
  const controls = model.controls()
  const markers = controls?.entries.filter(entry => entry.surfaceId === surface.id && model.markerVisible(entry.id)).map(entry => {
    const point = entry.selection.anchor ?? { x: entry.selection.rect.x + 16, y: entry.selection.rect.y }
    return <button type="button" key={entry.id} className={css.savedMarker} aria-label={`${t('packet.edit')} ${entry.id}`}
      style={{ left: bounds.left + point.x - 14, top: bounds.top + point.y - 28 }} onClick={() => controls.edit(entry.id)}>
      <ChatFilled width={34} height={34} /><span>{entry.id}</span>
    </button>
  })
  const toolbar = controls?.count ? <div className={css.toolbar} style={{ left: bounds.left + bounds.width / 2, top: bounds.bottom - 70 }}>
    <button type="button" onClick={controls.review}>{t('annotating')} · {controls.count}</button>
    <button type="button" aria-label={t('packet.remove')} title={t('packet.remove')} onClick={controls.clear}><Trash width={18} height={18} /></button>
    <button type="button" className={css.send} onClick={controls.send}>{t('send')}</button>
    <button type="button" aria-label={t('close')} title={t('close')} onClick={() => { void model.toggle(surface) }}><X width={18} height={18} /></button>
  </div> : null
  if (!selection) return createPortal(<>{markers}{toolbar}{draft.error && <div role="alert" className={css.notice}
    style={{ left: bounds.left + 12, top: bounds.top + 12 }}>{annotationErrorText(draft.error, t)}</div>}</>, document.body)
  const anchor = selection.anchor ?? { x: selection.rect.x + Math.min(32, selection.rect.width / 2), y: selection.rect.y }
  const x = bounds.left + anchor.x * bounds.width / selection.viewport.width
  const y = bounds.top + anchor.y * bounds.height / selection.viewport.height
  const width = Math.min(296, bounds.width - 24)
  const beside = x + width + 40 <= bounds.right - 12
  const left = beside ? x + 28 : Math.max(bounds.left + 12, Math.min(x - width / 2, bounds.right - width - 12))
  const expanded = draft.comment.length > 0
  const estimatedHeight = Math.max(56, (input.current?.scrollHeight ?? 24) + 32) + (expanded ? 44 : 0) + (draft.error ? 56 : 0)
  const top = Math.max(bounds.top + 12, Math.min(beside ? y - 40 : y + 16, bounds.bottom - estimatedHeight - 12))
  return createPortal(<>
    {markers}
    {toolbar}
    {draft.editing && <div className={css.outline} style={{ left: bounds.left + selection.rect.x, top: bounds.top + selection.rect.y,
      width: selection.rect.width, height: selection.rect.height }} />}
    {!draft.editing && <span className={css.marker} style={{ left: x - 16, top: y - 28 }} aria-hidden="true"><ChatFilled width={34} height={34} /></span>}
    <form ref={form} className={css.comment} style={{ left, top, width }} data-aione-annotation-comment
      aria-label={t('comment')} onSubmit={event => { event.preventDefault(); void model.save(surface) }}>
      <div className={css.commentRow}>
        <button type="button" className={css.icon} aria-label={t('adjust')} title={t('adjust')}
          aria-expanded={adjusting} disabled={draft.saving} onClick={() => setAdjusting(value => !value)}>
          <SettingsSlider width={16} height={16} />
        </button>
        <textarea ref={input} rows={1} value={draft.comment} placeholder={t('placeholder')} aria-label={t('comment')}
          disabled={draft.saving} onChange={event => model.setComment(surface.id, event.currentTarget.value)}
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault(); void model.save(surface)
            }
          }} />
      </div>
      {expanded && <div className={css.actions}>
        {draft.editing && <button type="button" className={`${css.icon} ${css.delete}`} aria-label={t('packet.remove')}
          disabled={draft.saving} onClick={() => { controls?.remove(draft.editing!.entry.id); model.cancel(surface.id) }}>
          <Trash width={18} height={18} />
        </button>}
        <button type="button" className={css.cancel} disabled={draft.saving} onClick={() => model.cancel(surface.id)}>{t('cancel')}</button>
        <button type="submit" className={css.save} aria-label={t('save')}
          disabled={draft.saving || !draft.comment.trim() || !model.hasTarget()}>{draft.saving ? t('adding') : t('save')}</button>
      </div>}
      {draft.error && <div className={css.error} role="alert">{annotationErrorText(draft.error, t)}</div>}
      {adjusting && <div className={css.adjust}>
        <button type="button" onClick={() => { model.cancel(surface.id); void model.setMode(surface, 'element') }}>{t('element')}</button>
        <button type="button" onClick={() => { model.cancel(surface.id); void model.setMode(surface, 'region') }}>{t('region')}</button>
        <button type="button" onClick={() => model.cancel(surface.id)}><X width={16} height={16} />{t('cancel')}</button>
      </div>}
    </form>
  </>, document.body)
}
