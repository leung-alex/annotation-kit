import { AnnotationError, annotationFailure, annotationErrorText, type AnnotationFailure } from '../../errors.ts'
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { WindowOverlay, useInteractiveWindowRegion } from '../../../ui/regions.tsx'
import type { Hooks, Selection } from '@fortune-sheet/core'
import type { PropsLocale } from '../../../host-contracts.ts'
import type { WorkbookInstance, Workbook as WorkbookComponent } from '@fortune-sheet/react'
import type { Sheet } from '@fortune-sheet/core'
import type { ComponentType, PropsWithoutRef, Ref, ComponentProps } from 'react'
import { DocumentWorkflow, type DocumentAnnotationBridge } from '../document-workflow.ts'
import { fileReference } from '../references.ts'
import { PageBatches } from '../pages/batches.ts'
import { BatchControls, CommentEditor, RequestIcon } from '../pages/DocumentChrome.tsx'
import css from '../pages/PageSelectionAction.module.css'
import { PaintedCells } from './geometry.ts'
import { readRange, spreadsheetSnapshot, type SpreadsheetSnapshot, type SheetRange } from './snapshot.ts'
import { registerSpreadsheet } from './navigation.ts'
import { SelectionCard } from '../SelectionCard.tsx'

type Translate = PropsLocale<'annotations'>['t']
type WorkbookProps = ComponentProps<typeof WorkbookComponent>
const copyMenu = ['copy']
const emptyMenu: string[] = []

export function SheetSurface({ resourceAddress: address, format, value, bridge, at: t, batches, t: excelT, Workbook, bodyCss, workbookCss = '' }: {
  resourceAddress: string; t: PropsLocale<string>['t']; Workbook: ComponentType<PropsWithoutRef<WorkbookProps> & { ref?: Ref<WorkbookInstance> }>;
  bodyCss: Record<string, string>; workbookCss?: string;
  format: 'xlsx' | 'csv'; value: { sheets: Sheet[]; unsupportedFeatures: string[] }; bridge: DocumentAnnotationBridge; at: Translate; batches: PageBatches
}) {
  const interactiveWindowRegion = useInteractiveWindowRegion()
  const workflow = useMemo(() => new DocumentWorkflow(bridge, batches), [bridge, batches])
  const mount = useRef<HTMLElement>(null), workbookHost = useRef<HTMLDivElement>(null), api = useRef<WorkbookInstance>(null)
  const input = useRef<HTMLTextAreaElement>(null), chrome = useRef<HTMLDivElement>(null)
  const [toolbar, setToolbar] = useState<Element | null>(null), [bounds, setBounds] = useState<DOMRect>()
  const [session, setSession] = useState(bridge.targetKey()), [mode, setMode] = useState(false)
  const [activeSheet, setActiveSheet] = useState(String(value.sheets.find(s => s.status === 1)?.id ?? value.sheets[0]!.id))
  const [selection, setSelection] = useState<SheetRange>(), [menu, setMenu] = useState(false)
  const [review, setReview] = useState(false)
  const [editor, setEditor] = useState<{ snapshot: SpreadsheetSnapshot; saved: boolean }>(), [comment, setComment] = useState('')
  const [editorHeight, setEditorHeight] = useState(0)
  const [error, setError] = useState<AnnotationFailure>(''), [busy, setBusy] = useState(false)
  const pending = useRef<AbortController>(), gesture = useRef(false), frame = useRef<number>()
  const selectionFrame = useRef<number>(), gestureFrame = useRef<number>()
  const painted = useRef(new PaintedCells()), [, repaint] = useState(0)
  const current = useRef({ mode, busy, editor, session, activeSheet })
  current.current = { mode, busy, editor, session, activeSheet }
  const selectionRef = useRef<Selection>()
  useSyncExternalStore(batches.subscribe, batches.getSnapshot)
  let items: readonly SpreadsheetSnapshot[] = []
  let restoreError: AnnotationFailure = ''
  try { if (session) items = batches.read(session, address).filter((s): s is SpreadsheetSnapshot => s.version === 3) } catch (e) { restoreError = annotationFailure(e) }
  const close = () => { setEditor(undefined); setMenu(false); setReview(false); setComment(''); setError(''); workbookHost.current?.focus({ preventScroll: true }) }
  const begin = (saved?: SpreadsheetSnapshot) => {
    if (!api.current || current.current.busy) return
    try {
      const selections = api.current.getSelection()
      const selected = selections?.[0] ?? selectionRef.current
      if (!saved && (selections?.length !== 1 || !selected)) throw new AnnotationError('error.separateRanges')
      const range = selected && readRange(selected)
      if (!saved && (!range || (range.row[1] - range.row[0] + 1) * (range.column[1] - range.column[0] + 1) > 4096)) throw new AnnotationError('error.selectionTooLarge')
      const snapshot = saved ?? spreadsheetSnapshot(address, format, api.current.getSheet(), selected!, api.current.getCellsByRange(selected!))
      fileReference(snapshot)
      setEditor({ snapshot, saved: !!saved }); setComment(snapshot.comment ?? ''); setMenu(false); setError('')
    } catch (e) { setError(annotationFailure(e)) }
  }
  const beginRef = useRef(begin); beginRef.current = begin
  const hooks = useMemo<Hooks>(() => ({
    beforeRenderCellArea: () => {
      if (frame.current === undefined) {
        painted.current.clear()
        frame.current = requestAnimationFrame(() => { frame.current = undefined; repaint(n => n + 1) })
      }
      return true
    },
    afterRenderCell: (_cell, info, ctx) => painted.current.record(info, ctx),
    afterRenderColumnHeaderCell: (_label, index, left, width, height, ctx) => painted.current.column(index, left, width, ctx, height),
    afterRenderRowHeaderCell: (_label, index, top, width, height, ctx) => painted.current.row(index, top, height, ctx, width),
    afterSelectionChange: (sheetId, selected) => {
      selectionRef.current = selected
      const next = readRange(selected)
      if (selectionFrame.current !== undefined) cancelAnimationFrame(selectionFrame.current)
      // FortuneSheet emits this from its own commit. Publish after that commit finishes.
      selectionFrame.current = requestAnimationFrame(() => {
        selectionFrame.current = undefined
        setSelection(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next)
        setActiveSheet(sheetId)
      })
    },
    afterActivateSheet: () => { setMenu(false); setEditor(undefined) },
  }), [])
  useEffect(() => bridge.subscribe(() => setSession(bridge.targetKey())), [])
  useEffect(() => {
    close(); setBusy(false); setMode(false)
    return () => pending.current?.abort()
  }, [session, address])
  useLayoutEffect(() => {
    const form = input.current?.closest('form')
    if (!editor || !form) { setEditorHeight(0); return }
    const measure = () => setEditorHeight(form.getBoundingClientRect().height)
    const observer = new ResizeObserver(measure)
    observer.observe(form); measure()
    return () => observer.disconnect()
  }, [editor?.snapshot.id, editor?.saved])
  useLayoutEffect(() => {
    const preview = mount.current?.closest<HTMLElement>('[data-textpreview-url]')
    if (!preview || !workbookHost.current) return
    setToolbar(preview.querySelector('[data-sheet-annotation-toolbar]'))
    const measure = () => { setBounds(mount.current!.getBoundingClientRect()); window.dispatchEvent(new Event('resize')) }
    const observer = new ResizeObserver(measure)
    observer.observe(workbookHost.current); measure()
    const scroll = () => { setBounds(mount.current!.getBoundingClientRect()) }
    window.addEventListener('scroll', scroll, true)
    return () => { observer.disconnect(); window.removeEventListener('scroll', scroll, true) }
  }, [])
  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (chrome.current?.contains(e.target as Node)) return
      if (!mount.current?.contains(e.target as Node)) { setMenu(false); if (!current.current.busy) setEditor(undefined); return }
      gesture.current = e.button === 0 && (e.target as Element).closest('.fortune-cell-area') !== null
      if (gesture.current && !current.current.busy) setEditor(undefined)
    }
    const up = () => {
      if (!gesture.current) return
      gesture.current = false
      gestureFrame.current = requestAnimationFrame(() => { gestureFrame.current = undefined; if (current.current.mode) beginRef.current(); else setMenu(true) })
    }
    const key = (e: KeyboardEvent) => {
      const within = mount.current?.closest('[data-textpreview-url]')?.contains(document.activeElement) || chrome.current?.contains(document.activeElement)
      if (!within) return
      if (e.key === 'Escape') { e.preventDefault(); if (!current.current.busy) { if (!current.current.editor) setMode(false); close() } }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'x' && !current.current.editor) {
        e.preventDefault(); e.stopPropagation(); beginRef.current()
      }
    }
    document.addEventListener('pointerdown', down, true); document.addEventListener('pointerup', up)
    window.addEventListener('keydown', key, true)
    return () => { document.removeEventListener('pointerdown', down, true); document.removeEventListener('pointerup', up); window.removeEventListener('keydown', key, true)
      if (frame.current !== undefined) cancelAnimationFrame(frame.current)
      if (selectionFrame.current !== undefined) cancelAnimationFrame(selectionFrame.current)
      if (gestureFrame.current !== undefined) cancelAnimationFrame(gestureFrame.current)
      pending.current?.abort() }
  }, [])
  useEffect(() => registerSpreadsheet(address, snapshot => {
    const workbook = api.current
    if (!workbook) throw new AnnotationError('error.sheetNotReady')
    const sheet = workbook.getAllSheets().find(s => String(s.id) === snapshot.sheet.id && s.name === snapshot.sheet.name)
      ?? workbook.getAllSheets().find(s => s.name === snapshot.sheet.name)
    if (!sheet || sheet.hide) throw new AnnotationError('error.sheetUnavailable')
    workbook.activateSheet({ id: sheet.id })
    requestAnimationFrame(() => { workbook.setSelection([snapshot.range], { id: sheet.id }); workbook.scroll({ targetRow: snapshot.range.row[0], targetColumn: snapshot.range.column[0] }) })
  }), [address])
  const run = async (operation: (signal: AbortSignal) => Promise<void>) => {
    if (busy || pending.current && !pending.current.signal.aborted || !session) return
    const controller = new AbortController(); pending.current = controller; setBusy(true); setError('')
    try { await operation(controller.signal); if (!controller.signal.aborted) close() }
    catch (e) { if (!controller.signal.aborted) setError(annotationFailure(e)) }
    finally { if (pending.current === controller) { pending.current = undefined; if (!controller.signal.aborted) setBusy(false) } }
  }
  const scope = { session: session ?? '', address }
  const save = () => { if (editor && comment.trim()) void run(signal => workflow.commit(scope, { kind: 'batch', snapshot: { ...editor.snapshot, comment: comment.trim() } }, signal)) }
  const remove = (ids: readonly string[]) => run(signal => workflow.remove(scope, ids, signal))
  const send = () => run(async signal => {
    await workflow.send(scope, signal)
    setMode(false)
  })
  const frozen = value.sheets.find(s => String(s.id) === activeSheet)?.frozen
  const editorBox = bounds && editor && editor.snapshot.sheet.id === activeSheet ? painted.current.range(editor.snapshot.range, bounds, frozen) : undefined
  const selectedBox = bounds && selection && painted.current.range(selection, bounds, frozen)
  const width = Math.min(296, (bounds?.width ?? 320) - 24)
  const left = editorBox && bounds ? Math.max(bounds.left + 12, Math.min(editorBox.right - width, bounds.right - width - 12)) : 0
  const height = editorHeight || (editor?.saved ? 148 : 56)
  const preferredTop = editorBox ? (editor?.saved ? editorBox.top - 28 : editorBox.bottom - 4) : 0
  const top = editorBox && bounds ? Math.max(bounds.top + 12, Math.min(
    preferredTop + height <= bounds.bottom - 12 ? preferredTop : editorBox.top - height - 8,
    bounds.bottom - height - 12,
  )) : 0
  const hasFormulas = value.sheets.some(s => s.celldata?.some(c => c.v?.f))
  return <section ref={mount} className={bodyCss.body} data-excel-preview data-annotation-sheet={address} aria-label={excelT('title')}>
    <style>{workbookCss}</style>
    {value.unsupportedFeatures.length > 0 && <div className={bodyCss.notice} role="note">{excelT('unsupportedNotice', { features: value.unsupportedFeatures.map(f => excelT(f)).join(excelT('featureSeparator')) })}</div>}
    <div ref={workbookHost} className={`${bodyCss.workbook} ${hasFormulas ? bodyCss.withFormulaWarning : ''}`} tabIndex={-1} style={{ outline: 'none' }}>
      {hasFormulas && <button className={bodyCss.formulaWarning} type="button" title={excelT('formulaWarning')} aria-label={excelT('formulaWarning')}>ⓘ</button>}
      <Workbook ref={api} data={value.sheets} hooks={hooks} lang={excelT('language')} rowHeaderWidth={46} columnHeaderHeight={20}
        allowEdit={false} showToolbar={false} showFormulaBar showSheetTabs forceCalculation={false}
        cellContextMenu={copyMenu} headerContextMenu={emptyMenu} sheetTabContextMenu={emptyMenu} filterContextMenu={emptyMenu} />
    </div>
    {toolbar && createPortal(<button {...interactiveWindowRegion} type="button" className={css.toggle} aria-pressed={mode} disabled={!session || busy} data-sheet-request-edits
      onClick={() => { close(); setMode(!mode) }}><RequestIcon />{t('page.request')}</button>, toolbar)}
    {bounds && <WindowOverlay ref={chrome} className={css.chrome} data-document-annotations data-sheet-annotations
      style={{ clipPath: `inset(${Math.max(0, bounds.top)}px ${Math.max(0, window.innerWidth - bounds.right)}px ${Math.max(0, window.innerHeight - bounds.bottom)}px ${Math.max(0, bounds.left)}px)` }}>
      {items.filter(s => s.sheet.id === activeSheet && s.id !== editor?.snapshot.id).map((item, i) => {
        const box = painted.current.range(item.range, bounds, frozen)
        return box && <div key={item.id}><div className={css.outline} style={box} data-sheet-range={item.a1} />
          <button {...interactiveWindowRegion} type="button" className={css.marker} aria-label={`${t('page.edit')} ${i + 1}`} style={{ left: Math.min(box.right - 13, bounds.right - 30), top: Math.max(bounds.top + 4, box.top - 13) }}
            onClick={() => begin(item)} disabled={busy} /></div>
      })}
      {menu && selectedBox && !editor && <button {...interactiveWindowRegion} type="button" className={css.ask} data-sheet-ask
        style={{ left: Math.max(bounds.left + 8, Math.min(selectedBox.left, bounds.right - 235)), top: Math.min(selectedBox.bottom + 8, bounds.bottom - 50) }}
        onPointerDown={e => e.preventDefault()} onClick={() => begin()}>{t('page.ask')}<kbd>Ctrl Shift X</kbd></button>}
      {editor && editorBox && <><div className={css.outline} style={editorBox} data-sheet-range={editor.snapshot.a1} />
        <span className={css.marker} style={{ left: Math.min(editorBox.right - 13, bounds.right - 30), top: Math.max(bounds.top + 4, editorBox.top - 13) }} />
        <CommentEditor key={editor.snapshot.id} t={t} style={{ left, top, width }} input={input} comment={comment} setComment={setComment}
          busy={busy} saved={editor.saved} save={save} cancel={close} remove={() => void remove([editor.snapshot.id])} /></>}
      {(mode || items.length > 0) && <BatchControls key={session} t={t} bounds={bounds} count={items.length} busy={busy} sendDisabled={!!editor || !workflow.canSend}
        review={() => { setEditor(undefined); setReview(!review) }}
        cancel={() => { void remove(items.map(s => s.id)).then(() => setMode(false)) }} send={() => void send()} />}
      {review && <div {...interactiveWindowRegion} className={css.snapshotReview} style={{ left: bounds.left + 12, top: bounds.top + 12, width: bounds.width - 24, maxHeight: bounds.height - 90 }}>
        <SelectionCard t={t} items={items} initiallyOpen onRemove={busy ? undefined : index => void remove([items[index]!.id])} />
      </div>}
      {(error || restoreError) && <div {...interactiveWindowRegion} className={css.error} role="alert" style={{ left: bounds.left + 12, top: bounds.top + 40, maxWidth: bounds.width - 24 }}>{annotationErrorText(error || restoreError, t)}</div>}
      {!workflow.canSend && (mode || items.length > 0) && <div role="status" className={css.error}
        style={{ left: bounds.left + 12, top: bounds.top + 40, maxWidth: bounds.width - 24 }}>{t('page.senderUnavailable')}</div>}
    </WindowOverlay>}
  </section>
}
