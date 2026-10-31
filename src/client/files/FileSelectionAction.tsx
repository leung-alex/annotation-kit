import { annotationFailure, annotationErrorText, type AnnotationFailure } from '../errors.ts'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Chat } from '../../ui/icons.tsx'
import type { PropsLocale, FileActionProps } from '../../host-contracts.ts'
import type { ComposerBridge } from '../../host-contracts.ts'
import { readFileSelection, type FileKind, type FileSelection } from './selection.ts'
import css from './FileSelectionAction.module.css'
import type { FileSnapshot } from './references.ts'

type ActionProps = FileActionProps & PropsLocale<'annotations'>

function sourceRoot(preview: HTMLElement, kind: FileKind): HTMLElement | null {
  const selector = kind === 'code' ? '[data-code-preview]'
    : kind === 'text' ? '[data-textpreview-plain]'
      : '[data-annotation-markdown-source] [data-document-markdown]'
  return preview.querySelector<HTMLElement>(selector)
}

type SelectionAnchor = { selection: FileSelection; left: number; top: number; above: boolean; target: string | undefined }

export function actionComponent(kind: FileKind, bridge: ComposerBridge) {
  return function FileSelectionAction({ content, useTabInfo, t }: ActionProps) {
    const { tab } = useTabInfo()
    const mount = useRef<HTMLSpanElement>(null)
    const popup = useRef<HTMLDivElement>(null)
    const pending = useRef<AbortController | null>(null)
    const mounted = useRef(false)
    const [selected, setSelected] = useState<SelectionAnchor>()
    const [target, setTarget] = useState(bridge.hasTarget())
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<AnnotationFailure>('')
    const source = content.kind === 'text' ? content.text : undefined
    const eof = content.kind === 'text' ? content.eof : false
    useEffect(() => {
      let previous = bridge.targetKey()
      return bridge.subscribe(() => {
        setTarget(bridge.hasTarget())
        if (previous !== bridge.targetKey()) {
          previous = bridge.targetKey()
          pending.current?.abort()
          setSelected(undefined)
        }
      })
    }, [])
    useEffect(() => {
      mounted.current = true
      return () => {
        mounted.current = false
        pending.current?.abort()
        pending.current = null
      }
    }, [])
    useEffect(() => {
      pending.current?.abort()
      pending.current = null
      setBusy(false)
      setSelected(undefined)
      setError('')
      const preview = mount.current?.closest<HTMLElement>('[data-textpreview-url]')
      if (preview === undefined || preview === null || source === undefined) return
      const capture = (): void => {
        const selection = window.getSelection()
        const body = sourceRoot(preview, kind)
        if (body === null || selection === null || selection.rangeCount === 0) {
          setSelected(undefined)
          return
        }
        const range = selection.getRangeAt(0)
        const value = readFileSelection(range, body, kind)
        if (!value) { setSelected(undefined); return }
        const bounds = preview.getBoundingClientRect()
        const rect = range.getBoundingClientRect()
        if (rect.bottom < bounds.top || rect.top > bounds.bottom || rect.right < bounds.left || rect.left > bounds.right) {
          setSelected(undefined)
          return
        }
        const width = popup.current?.offsetWidth || 140
        const above = kind === 'markdown' ? rect.top - bounds.top > 48 : rect.bottom + 48 > bounds.bottom
        setSelected({ selection: value, target: bridge.targetKey(), above,
          left: Math.max(bounds.left + 8, Math.min(rect.left, Math.min(bounds.right, window.innerWidth) - width - 8)),
          top: above ? Math.max(bounds.top + 48, rect.top - 8) : Math.min(bounds.bottom - 48, rect.bottom + 8),
        })
      }
      const escape = (event: KeyboardEvent): void => {
        if (event.key === 'Escape') {
          pending.current?.abort()
          setSelected(undefined)
          const native = window.getSelection()
          if (native?.anchorNode && preview.contains(native.anchorNode)) native.removeAllRanges()
        }
      }
      const outside = (event: PointerEvent): void => {
        if (event.target instanceof Node && !preview.contains(event.target) && !popup.current?.contains(event.target)) setSelected(undefined)
      }
      document.addEventListener('selectionchange', capture)
      preview.addEventListener('pointerup', capture)
      window.addEventListener('scroll', capture, true)
      window.addEventListener('resize', capture)
      window.addEventListener('keydown', escape)
      window.addEventListener('pointerdown', outside)
      return () => {
        document.removeEventListener('selectionchange', capture)
        preview.removeEventListener('pointerup', capture)
        window.removeEventListener('scroll', capture, true)
        window.removeEventListener('resize', capture)
        window.removeEventListener('keydown', escape)
        window.removeEventListener('pointerdown', outside)
        pending.current?.abort()
        pending.current = null
      }
    }, [tab.id, tab.contentId, source, eof, kind])
    if (content.kind !== 'text') return null
    const add = async (): Promise<void> => {
      if (selected === undefined || busy) return
      const selection: FileSnapshot = { ...selected.selection, version: 1, id: crypto.randomUUID(), address: tab.contentId, kind }
      const controller = new AbortController()
      pending.current?.abort()
      pending.current = controller
      setBusy(true)
      setError('')
      try {
        await bridge.add({ text: '', fileSelection: selection, signal: controller.signal, expectedTarget: selected.target })
        if (mounted.current && !controller.signal.aborted) {
          setSelected(undefined)
          const native = window.getSelection()
          const preview = mount.current?.closest('[data-textpreview-url]')
          if (native?.anchorNode && preview?.contains(native.anchorNode)) native.removeAllRanges()
        }
      } catch (failure) {
        if (mounted.current && !controller.signal.aborted) {
          setError(annotationFailure(failure))
        }
      } finally {
        if (pending.current === controller) {
          pending.current = null
          if (mounted.current) setBusy(false)
        }
      }
    }
    return <><span ref={mount} hidden />{selected && createPortal(<div ref={popup} className={css.action}
      style={{ left: selected.left, top: selected.top, transform: selected.above ? 'translateY(-100%)' : undefined }}
      data-file-selection-popover>
      <button type="button" className={css.button} data-annotation-file-add
        disabled={!target || busy}
        title={target ? t('file.addTitle') : t('file.openSession')}
        onPointerDown={event => event.preventDefault()}
        onClick={() => { void add() }}>
        <Chat width={16} height={16} />{busy ? t('file.adding') : t('file.add')}
      </button>
      {error !== '' && <span className={css.error} role="alert">{annotationErrorText(error, t)}</span>}
    </div>, document.body)}</>
  }
}
