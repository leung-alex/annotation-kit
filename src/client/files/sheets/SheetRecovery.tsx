import { annotationFailure, annotationErrorText, type AnnotationFailure } from '../../errors.ts'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { WindowOverlay, useInteractiveWindowRegion } from '../../../ui/regions.tsx'
import type { PropsLocale } from '../../../host-contracts.ts'
import { parseFileAddress } from '../../../address.ts'
import { DocumentWorkflow, type DocumentAnnotationBridge } from '../document-workflow.ts'
import { PageBatches } from '../pages/batches.ts'
import { BatchControls } from '../pages/DocumentChrome.tsx'
import { SelectionCard } from '../SelectionCard.tsx'
import type { SpreadsheetSnapshot } from './snapshot.ts'
import css from '../pages/PageSelectionAction.module.css'

export function failedSheetPreview(root: ParentNode) {
  for (const host of root.querySelectorAll<HTMLElement>('[data-textpreview-url]')) {
    const address = host.dataset.textpreviewUrl!
    if (!/\.(xlsx|csv)$/iu.test(parseFileAddress(address)?.path ?? '') || host.querySelector('[data-annotation-sheet]')) continue
    if (host.querySelector('[data-textpreview-failed], [data-sheet-load-error]')) return { host, address }
  }
}

/** The session overlay outlives a failed document body. Its UI stays inside that preview. */
export function sheetRecoveryComponent(bridge: DocumentAnnotationBridge, batches: PageBatches) {
  const workflow = new DocumentWorkflow(bridge, batches)
  return function SheetRecovery({ sessionId, t }: PropsLocale<'annotations'> & { sessionId: string }) {
  const interactiveWindowRegion = useInteractiveWindowRegion()
    const [target, setTarget] = useState<ReturnType<typeof failedSheetPreview>>()
    const [bounds, setBounds] = useState<DOMRect>(), [busy, setBusy] = useState(false), [error, setError] = useState<AnnotationFailure>('')
    const pending = useRef<AbortController>()
    useSyncExternalStore(batches.subscribe, batches.getSnapshot)
    useEffect(() => {
      let frame: number | undefined
      const scan = () => {
        frame = undefined
        const next = bridge.targetKey() === sessionId ? failedSheetPreview(document) : undefined
        setTarget(previous => previous?.host === next?.host && previous?.address === next?.address ? previous : next)
      }
      const schedule = () => { if (frame === undefined) frame = requestAnimationFrame(scan) }
      const observer = new MutationObserver(schedule)
      observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-textpreview-url', 'data-textpreview-failed'] })
      const unsubscribe = bridge.subscribe(schedule)
      scan()
      return () => { observer.disconnect(); unsubscribe(); if (frame !== undefined) cancelAnimationFrame(frame) }
    }, [sessionId])
    useEffect(() => {
      setError(''); setBusy(false)
      if (!target) return
      const measure = () => setBounds(target.host.getBoundingClientRect())
      const observer = new ResizeObserver(measure)
      observer.observe(target.host); measure()
      window.addEventListener('resize', measure)
      return () => { observer.disconnect(); window.removeEventListener('resize', measure); pending.current?.abort() }
    }, [target, sessionId])
    if (!target || !bounds || bounds.width === 0) return null
    let items: readonly SpreadsheetSnapshot[]
    try { items = batches.read(sessionId, target.address).filter((s): s is SpreadsheetSnapshot => s.version === 3) }
    catch { return null }
    if (!items.length) return null
    const run = async (send: boolean, ids = items.map(item => item.id)) => {
      if (busy || pending.current && !pending.current.signal.aborted) return
      const controller = new AbortController(); pending.current = controller; setBusy(true); setError('')
      try {
        if (send) {
          await workflow.send({ session: sessionId, address: target.address }, controller.signal)
        } else await workflow.remove({ session: sessionId, address: target.address }, ids, controller.signal)
      } catch (e) { if (!controller.signal.aborted) setError(annotationFailure(e)) }
      finally { if (pending.current === controller) { pending.current = undefined; if (!controller.signal.aborted) setBusy(false) } }
    }
    return <WindowOverlay className={css.chrome} data-sheet-recovery>
      <div {...interactiveWindowRegion} className={css.snapshotReview} style={{ left: bounds.left + 12, top: bounds.top + 58, width: bounds.width - 24, maxHeight: bounds.height - 125 }}>
        <p>{t('sheet.unavailable')}</p>
        {!workflow.canSend && <p role="status">{t('page.senderUnavailable')}</p>}
        <SelectionCard t={t} items={items} initiallyOpen onRemove={busy ? undefined : index => void run(false, [items[index]!.id])} />
        {error && <p role="alert">{annotationErrorText(error, t)}</p>}
      </div>
      <BatchControls t={t} bounds={bounds} count={items.length} busy={busy} sendDisabled={!workflow.canSend}
        cancel={() => void run(false)} send={() => void run(true)} />
    </WindowOverlay>
  }
}
