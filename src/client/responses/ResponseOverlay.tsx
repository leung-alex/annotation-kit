import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { WindowOverlay, useInteractiveWindowRegion } from '../../ui/regions.tsx'
import type { PropsLocale } from '../../host-contracts.ts'
import { CommentEditor } from '../files/pages/DocumentChrome.tsx'
import { annotationErrorText, annotationFailure } from '../errors.ts'
import type { ResponseController } from './controller.ts'
import chrome from '../files/pages/PageSelectionAction.module.css'
import css from './responses.module.css'

function viewport(root: HTMLElement): DOMRect {
  const frame = root.closest<HTMLElement>('[data-conversation-scroll]')
  if (frame) return frame.getBoundingClientRect()
  for (let parent = root.parentElement; parent; parent = parent.parentElement) {
    if (/(auto|scroll)/u.test(getComputedStyle(parent).overflowY)) return parent.getBoundingClientRect()
  }
  return (root.closest<HTMLElement>('[data-chat-flow]') ?? root).getBoundingClientRect()
}
const boxes = (ranges: readonly Range[]): DOMRect[] => ranges.flatMap(range => Array.from(range.getClientRects())).filter(rect => rect.width > 0 && rect.height > 0)

export function ResponseOverlay({ controller, sessionId, t }: PropsLocale<'annotations'> & { readonly controller: ResponseController; readonly sessionId: string }) {
  const interactiveWindowRegion = useInteractiveWindowRegion()
  useSyncExternalStore(controller.subscribe, controller.getSnapshot)
  const [layout, setLayout] = useState(0)
  const [comment, setComment] = useState('')
  const input = useRef<HTMLTextAreaElement>(null)
  const addButton = useRef<HTMLButtonElement>(null)
  const [addSize, setAddSize] = useState({ width: 0, height: 0 })
  const overlay = useRef<HTMLDivElement>(null)
  const observedEditors = useRef(new Set<string>())
  useEffect(() => controller.composer.subscribe(() => { setLayout(value => value + 1) }), [controller])
  const active = controller.composer.targetKey() === sessionId
  const editor = active && controller.editor?.snapshot.sessionId === sessionId ? controller.editor : undefined
  const candidate = active ? controller.candidate : undefined
  const items = active ? controller.composer.responses?.read(sessionId) ?? [] : []
  const source = [...controller.surfaces].find(surface => surface.source.sessionId === sessionId)?.root
  const frameRoot = source?.closest('[data-chat-flow]') ?? source
  useLayoutEffect(() => { setComment(editor?.snapshot.comment ?? '') }, [editor])
  useLayoutEffect(() => {
    const button = addButton.current
    if (!button) return
    const measure = () => {
      const { width, height } = button.getBoundingClientRect()
      setAddSize(previous => previous.width === width && previous.height === height ? previous : { width, height })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(button)
    return () => observer.disconnect()
  }, [candidate, editor, t])
  useLayoutEffect(() => {
    if (!active) return
    const observer = new ResizeObserver(() => setLayout(value => value + 1))
    if (frameRoot) observer.observe(frameRoot)
    if (input.current?.form) observer.observe(input.current.form)
    return () => observer.disconnect()
  }, [active, frameRoot, editor])
  useEffect(() => {
    if (!active) return
    let frame = 0
    const measure = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => setLayout(value => value + 1)) }
    const select = () => {
      if (overlay.current?.contains(document.activeElement)) return
      controller.select(sessionId)
    }
    const keyup = (event: KeyboardEvent) => { if (!event.isComposing && event.key.startsWith('Arrow')) select() }
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !overlay.current?.contains(event.target)) {
        if (controller.editor) controller.dismiss()
        else if (controller.selectedId) controller.dismiss()
      }
    }
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Tab' && !event.shiftKey && controller.candidate && !controller.editor
        && !overlay.current?.contains(document.activeElement)) {
        const add = overlay.current?.querySelector<HTMLButtonElement>('[data-response-add]')
        if (add) { event.preventDefault(); add.focus(); return }
      }
      if (event.key !== 'Escape' || event.isComposing || (!controller.editor && !controller.candidate && !controller.selectedId)) return
      event.preventDefault()
      controller.dismiss(true)
    }
    document.addEventListener('selectionchange', select)
    document.addEventListener('pointerup', select)
    document.addEventListener('keyup', keyup)
    document.addEventListener('keydown', keydown)
    document.addEventListener('pointerdown', outside)
    window.addEventListener('scroll', measure, true)
    window.addEventListener('resize', measure)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener('selectionchange', select); document.removeEventListener('pointerup', select)
      document.removeEventListener('keyup', keyup); document.removeEventListener('keydown', keydown); document.removeEventListener('pointerdown', outside)
      window.removeEventListener('scroll', measure, true); window.removeEventListener('resize', measure)
      controller.dismiss()
    }
  }, [active, controller, sessionId])
  // An undo, removal or successful send must also remove its editor/highlight.
  useEffect(() => {
    if (!editor) return
    if (items.some(item => item.id === editor.snapshot.id)) observedEditors.current.add(editor.snapshot.id)
    else if (observedEditors.current.has(editor.snapshot.id) && !controller.busy) controller.dismiss()
  }, [controller, editor, items])
  if (!active) return null
  const fallback = document.querySelector<HTMLElement>('[data-chat-flow]')
  if (!source && !fallback) return null
  const bounds = viewport(source ?? fallback!)
  if (bounds.width < 1 || bounds.height < 1) return null
  const visible = (box: DOMRect) => box.bottom > bounds.top && box.top < bounds.bottom && box.right > bounds.left && box.left < bounds.right
  const entries = items.map(snapshot => {
    const ranges = controller.ranges(snapshot)
    const root = ranges[0]?.startContainer.parentElement?.closest<HTMLElement>('[data-response-source]')
    return { snapshot, rects: boxes(ranges), root }
  })
  const selectedRanges = controller.selected ? controller.ranges(controller.selected) : []
  const selectedRoot = selectedRanges[0]?.startContainer.parentElement?.closest<HTMLElement>('[data-response-source]')
  const readonlySelection = controller.selected && !items.some(item => item.id === controller.selectedId) && !editor
    ? boxes(selectedRanges).filter(visible) : []
  const pick = candidate && boxes(candidate.ranges).filter(visible).at(-1)
  const editing = editor && (entries.find(entry => entry.snapshot.id === editor.snapshot.id)?.rects.filter(visible).at(-1)
    ?? new DOMRect(bounds.left + bounds.width / 2, bounds.bottom - 30, 0, 0))
  const panelWidth = Math.max(100, Math.min(296, bounds.width - 16))
  const panelHeight = input.current?.form?.getBoundingClientRect().height || (editor?.initial ? 46 : 128)
  const position = (box: DOMRect, width: number, height: number) => ({ width,
    left: Math.max(bounds.left + 8, Math.min(box.right - width, bounds.right - width - 8)),
    top: Math.max(bounds.top + 8, Math.min(box.top - height - 12 >= bounds.top ? box.top - height - 12 : box.bottom + 10, bounds.bottom - height - 8)) })
  return <WindowOverlay ref={overlay} className={`${chrome.chrome} ${css.overlay}`} data-response-annotation-ui data-layout-revision={layout}
    style={{ clipPath: `inset(${Math.max(0, bounds.top)}px ${Math.max(0, window.innerWidth - bounds.right)}px ${Math.max(0, window.innerHeight - bounds.bottom)}px ${Math.max(0, bounds.left)}px)` }}>
    {selectedRoot && createPortal(<div data-response-annotation-ui className={css.markers}>
      {readonlySelection.map((rect, index) => <span key={`source:${index}`} className={css.highlight}
        style={{ left: rect.left - selectedRoot.getBoundingClientRect().left, top: rect.top - selectedRoot.getBoundingClientRect().top, width: rect.width, height: rect.height }} />)}
    </div>, selectedRoot)}
    {entries.map(({ snapshot, rects, root }, index) => {
      const visibleRects = rects.filter(visible)
      const end = visibleRects.at(-1)
      if (!end || !root) return null
      const origin = root.getBoundingClientRect()
      return createPortal(<div data-response-annotation-ui className={css.markers}>
        {controller.selectedId === snapshot.id && visibleRects.map((rect, boxIndex) => <span key={boxIndex} className={css.highlight}
          style={{ left: rect.left - origin.left, top: rect.top - origin.top, width: rect.width, height: rect.height }} />)}
        <button {...interactiveWindowRegion} type="button" className={`${chrome.marker} ${css.marker}`} aria-label={`${t('response.edit')} ${index + 1}`}
          style={{ left: Math.max(bounds.left + 2, Math.min(end.right + 4, bounds.right - 22)) - origin.left, top: Math.max(bounds.top + 2, end.top + end.height / 2 - 10) - origin.top }}
          onClick={event => { void controller.open(snapshot, true, event.currentTarget).catch(error => { controller.failure = annotationFailure(error); controller.changed() }) }}>{index + 1}</button>
      </div>, root, snapshot.id)
    })}
    {pick && !editor && <button {...interactiveWindowRegion} ref={addButton} type="button" className={`${chrome.ask} ${css.ask}`} data-response-add
      style={{ ...position(pick, addSize.width || 80, addSize.height || 28), width: 'max-content', maxWidth: bounds.width - 16 }} disabled={controller.busy}
      onPointerDown={event => event.preventDefault()} onClick={() => { void controller.add() }}>{t('response.add')}</button>}
    {editor && editing && <CommentEditor key={`${editor.snapshot.id}:${editor.initial}`} optional t={t} input={input}
      style={position(editing, panelWidth, panelHeight)} comment={comment} setComment={setComment} saved={!editor.initial} busy={controller.busy}
      save={() => controller.save(comment)} cancel={() => controller.dismiss(true)} remove={() => controller.remove()} />}
    {controller.failure && <div {...interactiveWindowRegion} role="alert" className={chrome.error}
      style={{ left: bounds.left + 12, top: bounds.bottom - 70, maxWidth: bounds.width - 24 }}>{annotationErrorText(controller.failure, t)}</div>}
  </WindowOverlay>
}
