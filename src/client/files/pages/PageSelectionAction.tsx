import { annotationFailure, annotationErrorText, type AnnotationFailure } from '../../errors.ts'
import { useEffect, useLayoutEffect, useReducer, useRef, useState, useSyncExternalStore } from 'react'
import { WindowOverlay, useInteractiveWindowRegion } from '../../../ui/regions.tsx'
import { RequestIcon, CommentEditor, BatchControls } from './DocumentChrome.tsx'
import type { PropsLocale } from '../../../host-contracts.ts'
import { DocumentWorkflow, type DocumentAnnotationBridge } from '../document-workflow.ts'
import { capturePageRegion, pageRegion, readPageText } from './selection.ts'
import { PageBatches } from './batches.ts'
import { enclosing, pageBounds, projectAnchors, rangeAnchors, type Anchor, type Box } from './geometry.ts'
import type { PageRect, PageSnapshot } from './snapshot.ts'
import css from './PageSelectionAction.module.css'
import { pageInteraction } from './interaction.ts'

interface Pick {
  source?: Node
  value: { text: string; startPage: number; endPage: number } | { canvas: HTMLCanvasElement; region: PageRect; page: number }
  anchors: readonly Anchor[]
  bounds: Box
}
type EditorPick = Pick & ({ intent: 'batch'; saved?: PageSnapshot } | { intent: 'presentation-request'; saved?: never })
const requestPick = (pick: Pick, presentation: boolean): EditorPick => presentation
  ? { ...pick, intent: 'presentation-request' } : { ...pick, intent: 'batch' }
export function pageActionComponent(bridge: DocumentAnnotationBridge, batches = new PageBatches()) {
  const workflow = new DocumentWorkflow(bridge, batches)
  return function PageSelectionAction({ absolutePath, t }: PropsLocale<'annotations'> & { absolutePath: string }) {
  const interactiveWindowRegion = useInteractiveWindowRegion()
    const mount = useRef<HTMLSpanElement>(null), chrome = useRef<HTMLDivElement>(null), input = useRef<HTMLTextAreaElement>(null)
    const pending = useRef<AbortController>(), operationId = useRef(0)
    const [preview, setPreview] = useState<HTMLElement>(), [bounds, setBounds] = useState<DOMRect>()
    const [session, setSession] = useState(bridge.targetKey()), [mode, setMode] = useState(false)
    const [interaction, dispatch] = useReducer(pageInteraction<Pick, EditorPick>, { phase: 'idle', error: '' })
    const current = useRef(interaction); current.current = interaction
    const menu = interaction.phase === 'selected' ? interaction.selection : undefined
    const editor = 'draft' in interaction ? interaction.draft : undefined
    const comment = 'comment' in interaction ? interaction.comment ?? '' : ''
    const busy = interaction.phase === 'submitting', error = interaction.error
    const liveEditor = () => 'draft' in current.current ? current.current.draft : undefined
    const liveMenu = () => current.current.phase === 'selected' ? current.current.selection : undefined
    const setComment = (value: string) => dispatch({ type: 'comment', value })
    const [outline, setOutline] = useState<Box>()
    const [, geometry] = useState(0)
    useSyncExternalStore(batches.subscribe, batches.getSnapshot)
    const supported = /\.(pdf|docx?|pptx?)$/iu.test(absolutePath)
    const kind = /\.pdf$/iu.test(absolutePath) ? 'pdf' : 'office', presentation = /\.pptx?$/iu.test(absolutePath)
    const address = preview?.dataset.textpreviewUrl ?? ''
    const scope = { session: session ?? '', address }
    let items: readonly PageSnapshot[] = []
    let restoreError: AnnotationFailure = ''
    try { if (session && address) items = batches.read(session, address).filter((item): item is PageSnapshot => item.version === 2) } catch (e) { restoreError = annotationFailure(e) }
    const select = (selection?: Pick) => dispatch({ type: 'select', selection })
    const cancelEditor = () => { pending.current?.abort(); dispatch({ type: 'cancel' }); setOutline(undefined) }
    const begin = (draft: EditorPick) => {
      if (draft.intent === 'presentation-request' && !workflow.canSend) return
      dispatch({ type: 'edit', draft, comment: draft.saved?.comment ?? '' })
      window.getSelection()?.removeAllRanges()
    }
    useLayoutEffect(() => { setPreview(mount.current?.closest<HTMLElement>('[data-textpreview-url]') ?? undefined) }, [absolutePath])
    useEffect(() => bridge.subscribe(() => setSession(bridge.targetKey())), [])
    useEffect(() => { cancelEditor(); setMode(false); return () => { pending.current?.abort() } }, [session, address])
    useLayoutEffect(() => {
      if (!preview) return
      const measure = () => { setBounds(preview.getBoundingClientRect()); geometry(n => n + 1) }
      measure()
      const observer = new ResizeObserver(measure)
      observer.observe(preview)
      // PDF canvases may arrive after the preview container has reached its final size.
      const pages = new MutationObserver(measure)
      pages.observe(preview, { childList: true, subtree: true, attributes: true, attributeFilter: ['width', 'height'] })
      window.addEventListener('resize', measure); window.addEventListener('scroll', measure, true)
      return () => { observer.disconnect(); pages.disconnect(); window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true) }
    }, [preview])
    useLayoutEffect(() => { if (editor) input.current?.focus() }, [editor])
    useLayoutEffect(() => {
      if (!input.current) return
      input.current.style.height = '24px'
      input.current.style.height = `${Math.min(144, input.current.scrollHeight)}px`
    }, [comment, editor])
    useEffect(() => {
      if (!preview || !supported) return
      let drag: { pointer: number; start: { x: number; y: number }; canvas: HTMLCanvasElement; page: number; element: Element } | undefined
      const captureText = () => {
        if (mode || liveEditor()) return
        const selection = window.getSelection(), range = selection?.rangeCount ? selection.getRangeAt(0) : undefined
        const value = range && readPageText(range, preview)
        if (!range || !value) { select(); return }
        select({ value, source: range.startContainer, anchors: rangeAnchors(range, preview), bounds: range.getBoundingClientRect() })
      }
      const start = (event: PointerEvent) => {
        if (!mode || busy || event.button !== 0 || !(event.target instanceof Element)) return
        const page = event.target.closest<HTMLElement>('[data-pdf-page]'), canvas = page?.querySelector('canvas')
        if (!canvas || !preview.contains(canvas) || !canvas.width || !canvas.height) return
        const box = canvas.getBoundingClientRect()
        if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) return
        event.preventDefault(); event.stopPropagation(); cancelEditor(); window.getSelection()?.removeAllRanges()
        drag = { pointer: event.pointerId, start: { x: event.clientX, y: event.clientY }, canvas, page: Number(page!.dataset.pdfPage), element: event.target }
        preview.setPointerCapture(event.pointerId)
      }
      const move = (event: PointerEvent) => {
        if (!drag || event.pointerId !== drag.pointer) return
        const rect = pageRegion(drag.start, { x: event.clientX, y: event.clientY }, drag.canvas.getBoundingClientRect())
        setOutline(rect ? projectAnchors([{ page: drag.page, rect }], preview)[0] : undefined)
      }
      const end = (event: PointerEvent) => {
        if (!drag || event.pointerId !== drag.pointer) return
        const active = drag; drag = undefined
        if (preview.hasPointerCapture(event.pointerId)) preview.releasePointerCapture(event.pointerId)
        const region = pageRegion(active.start, { x: event.clientX, y: event.clientY }, active.canvas.getBoundingClientRect())
        setOutline(undefined)
        if (region) {
          const anchors = [{ page: active.page, rect: region }], box = projectAnchors(anchors, preview)[0]
          if (box) begin({ intent: 'batch', source: active.canvas, anchors, bounds: box, value: { canvas: active.canvas, region, page: active.page } })
        } else {
          // These are rendered PDF text targets, not inferred Office object identities.
          const span = active.element.closest('[data-pdf-text] span')
          if (!span) return
          const range = document.createRange(); range.selectNodeContents(span)
          const value = readPageText(range, preview)
          if (value) begin({ intent: 'batch', source: span, anchors: rangeAnchors(range, preview), bounds: span.getBoundingClientRect(), value })
        }
      }
      const keyboard = (event: KeyboardEvent) => {
        if (event.isComposing) return
        if (event.key === 'Escape') {
          if (liveEditor() || liveMenu()) { event.preventDefault(); cancelEditor() }
          else setMode(false)
        }
        const selected = liveMenu()
        if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'x' && selected) {
          event.preventDefault(); begin(requestPick(selected, presentation))
        }
      }
      const outside = (event: PointerEvent) => {
        if (!(event.target instanceof Node) || chrome.current?.contains(event.target) || mount.current?.contains(event.target)) return
        if (liveEditor() && !busy) cancelEditor()
        if (!preview.contains(event.target)) select()
      }
      const mutations = new MutationObserver(records => {
        const source = liveEditor()?.source ?? liveMenu()?.source
        const page = (source instanceof Element ? source : source?.parentElement)?.closest('[data-pdf-page]')
        if (source && (!source.isConnected || records.some(r => page?.contains(r.target) && (r.type !== 'childList'
          || [...r.addedNodes, ...r.removedNodes].some(node => !(node instanceof Element && node.classList.contains('endOfContent'))))))) cancelEditor()
        if (drag && !drag.canvas.isConnected) { drag = undefined; setOutline(undefined) }
      })
      mutations.observe(preview, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['width', 'height'] })
      if (mode) preview.dataset.pageRegionSelecting = 'true'
      const cancelDrag = () => { drag = undefined; setOutline(undefined) }
      document.addEventListener('selectionchange', captureText); preview.addEventListener('pointerdown', start, true)
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', end)
      window.addEventListener('pointercancel', cancelDrag); window.addEventListener('scroll', cancelDrag, true)
      window.addEventListener('keydown', keyboard); window.addEventListener('pointerdown', outside)
      return () => {
        mutations.disconnect(); delete preview.dataset.pageRegionSelecting
        document.removeEventListener('selectionchange', captureText); preview.removeEventListener('pointerdown', start, true)
        window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end)
        window.removeEventListener('pointercancel', cancelDrag); window.removeEventListener('scroll', cancelDrag, true)
        window.removeEventListener('keydown', keyboard); window.removeEventListener('pointerdown', outside)
      }
    }, [preview, supported, mode, busy])
    if (!supported) return null
    const save = async () => {
      if (!editor || !session || !comment.trim() || busy || pending.current && !pending.current.signal.aborted || (editor.source && !editor.source.isConnected)) return
      const controller = new AbortController(); pending.current?.abort(); pending.current = controller
      const token = ++operationId.current
      dispatch({ type: 'start', operation: 'commit', token })
      try {
        let snapshot = editor.saved, image: File | undefined
        if (!snapshot) {
          const id = crypto.randomUUID()
          if ('canvas' in editor.value) {
            const capture = await capturePageRegion(editor.value.canvas, editor.value.region, id, controller.signal)
            image = capture.file
            snapshot = { version: 2, id, address, kind, text: '', startPage: editor.value.page, endPage: editor.value.page,
              anchors: editor.anchors, region: editor.value.region, image: capture.image }
          } else snapshot = { version: 2, id, address, kind, ...editor.value, anchors: editor.anchors }
        }
        snapshot = { ...snapshot, comment: comment.trim() }
        if (editor.intent === 'presentation-request') {
          await workflow.commit(scope, { kind: 'presentation-request', snapshot }, controller.signal)
        } else await workflow.commit(scope, { kind: 'batch', snapshot, image }, controller.signal)
        if (!controller.signal.aborted) { dispatch({ type: 'complete', token }); setOutline(undefined) }
      } catch (e) { if (!controller.signal.aborted) dispatch({ type: 'fail', token, error: annotationFailure(e) }) }
      finally { if (pending.current === controller) pending.current = undefined }
    }
    const remove = async (ids: readonly string[]) => {
      if (!session || busy || pending.current && !pending.current.signal.aborted) return
      const controller = new AbortController(), token = ++operationId.current
      pending.current = controller; dispatch({ type: 'start', operation: 'batch-remove', token })
      try { await workflow.remove(scope, ids, controller.signal); if (!controller.signal.aborted) dispatch({ type: 'complete', token }) }
      catch (e) { if (!controller.signal.aborted) dispatch({ type: 'fail', token, error: annotationFailure(e) }) }
      finally { if (pending.current === controller) pending.current = undefined }
    }
    const send = async () => {
      if (!session || !items.length || busy || pending.current && !pending.current.signal.aborted || editor || !workflow.canSend) return
      const controller = new AbortController(), token = ++operationId.current
      pending.current = controller; dispatch({ type: 'start', operation: 'batch-send', token })
      try {
        await workflow.send(scope, controller.signal)
        if (!controller.signal.aborted) { setMode(false); dispatch({ type: 'complete', token }) }
      } catch (e) { if (!controller.signal.aborted) dispatch({ type: 'fail', token, error: annotationFailure(e) }) }
      finally { if (pending.current === controller) pending.current = undefined }
    }
    const openSaved = (item: PageSnapshot) => {
      if (busy || !preview) return
      const anchors = item.anchors ?? (item.region ? [{ page: item.startPage, rect: item.region }] : [])
      const box = enclosing(projectAnchors(anchors, preview)) ?? pageBounds(preview, item.startPage)
      if (box) begin({ intent: 'batch', saved: item, anchors, bounds: box, value: item })
    }
    const editorBoxes = editor && preview ? projectAnchors(editor.anchors, preview) : []
    const editorBox = enclosing(editorBoxes) ?? editor?.bounds
    const width = Math.min(296, (bounds?.width ?? 320) - 24)
    const beside = editorBox && bounds && editorBox.right + width + 24 < bounds.right
    const left = editorBox && bounds ? Math.max(bounds.left + 12, Math.min(beside ? editorBox.right + 18 : editorBox.right - width, bounds.right - width - 12)) : 0
    const top = editorBox && bounds ? Math.max(bounds.top + 48, Math.min(beside ? editorBox.top - 24 : editorBox.bottom + 8,
      bounds.bottom - (editor?.saved ? 160 : Math.max(64, (input.current?.scrollHeight ?? 24) + 40)))) : 0
    const visible = (box: Box) => bounds && box.bottom > bounds.top + 40 && box.top < bounds.bottom && box.right > bounds.left && box.left < bounds.right
    return <span {...interactiveWindowRegion} ref={mount} className={css.control}>
      <button type="button" className={css.toggle} data-page-region-toggle aria-pressed={mode} disabled={!session || busy}
        onClick={() => { cancelEditor(); setMode(!mode) }}><RequestIcon />{t('page.request')}</button>
      {preview && bounds && <WindowOverlay ref={chrome} className={css.chrome} data-document-annotations
        style={{ clipPath: `inset(${bounds.top + 40}px ${Math.max(0, window.innerWidth - bounds.right)}px ${Math.max(0, window.innerHeight - bounds.bottom)}px ${bounds.left}px)` }}>
        {items.map(item => {
          if (item.id === editor?.saved?.id) return null
          const boxes = projectAnchors(item.anchors ?? [], preview), box = enclosing(boxes)
          return box && visible(box) ? <div key={item.id}>{boxes.filter(visible).map((b, i) => <div key={i} className={css.outline} style={b} />)}
            <button {...interactiveWindowRegion} type="button" className={css.marker} aria-label={`${t('page.edit')} ${items.indexOf(item) + 1}`}
              style={{ left: Math.min(box.right - 13, bounds.right - 30), top: Math.max(bounds.top + 44, box.top - 13) }} onClick={() => openSaved(item)} />
          </div> : null
        })}
        {outline && <div className={css.outline} style={outline} />}
        {menu && !editor && visible(menu.bounds) && <button {...interactiveWindowRegion} type="button" className={css.ask} data-page-ask
          disabled={presentation && !workflow.canSend}
          style={{ left: Math.max(bounds.left + 8, Math.min(menu.bounds.right, bounds.right - 230)), top: Math.min(menu.bounds.bottom + 8, bounds.bottom - 44) }}
          onPointerDown={e => e.preventDefault()} onClick={() => begin(requestPick(menu, presentation))}>
          {presentation ? <><RequestIcon />{t('page.request')}</> : <>{t('page.ask')}<kbd>Ctrl Shift X</kbd></>}
        </button>}
        {editor && editorBox && visible(editorBox) && <>
          {(editorBoxes.length ? editorBoxes : [editorBox]).filter(visible).map((box, i) => <div key={i} className={css.outline} style={{ ...box, borderStyle: editor.intent === 'presentation-request' ? 'solid' : undefined }} />)}
          {editor.intent === 'batch' && <span className={css.marker} style={{ left: Math.min(editorBox.right - 13, bounds.right - 30), top: Math.max(bounds.top + 44, editorBox.top - 13) }} />}
          <CommentEditor key={editor.saved?.id ?? 'new'} t={t} style={{ left, top, width }} input={input}
            comment={comment} setComment={setComment} busy={busy} saved={!!editor.saved} direct={editor.intent === 'presentation-request'}
            save={() => void save()} cancel={cancelEditor} remove={() => void remove([editor.saved!.id])} />
        </>}
        {(mode || items.length > 0) && <BatchControls key={`${session}:${address}`} t={t} bounds={bounds}
          count={items.length} busy={busy} sendDisabled={!!editor || !workflow.canSend}
          cancel={() => { void remove(items.map(item => item.id)).then(() => setMode(false)) }} send={() => void send()} />}
        {(error || restoreError) && <div {...interactiveWindowRegion} className={css.error} role="alert" style={{ left: bounds.left + 12, bottom: window.innerHeight - bounds.bottom + 60, maxWidth: bounds.width - 24 }}>{annotationErrorText(error || restoreError, t)}</div>}
        {!workflow.canSend && (mode || items.length > 0 || menu) && <div role="status" className={css.error}
          style={{ left: bounds.left + 12, bottom: window.innerHeight - bounds.bottom + 60, maxWidth: bounds.width - 24 }}>{t('page.senderUnavailable')}</div>}
      </WindowOverlay>}
    </span>
  }
}
