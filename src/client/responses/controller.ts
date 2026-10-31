import { AnnotationError, annotationFailure, type AnnotationFailure } from '../errors.ts'
import type { ComposerBridge } from '../../host-contracts.ts'
import type { ResponseAnnotationSnapshot } from './references.ts'
import { projectResponseText, rangesForAnchor, readResponseSelection, selectionCurrent, type ResponseSelection, type ResponseSurface } from './selection.ts'

export interface ResponseEditor {
  readonly snapshot: ResponseAnnotationSnapshot
  readonly initial: boolean
  readonly trigger?: HTMLElement
}

/** Ephemeral surface/interaction state only. All saved content lives in Composer references. */
export class ResponseController {
  readonly surfaces = new Set<ResponseSurface>()
  private listeners = new Set<() => void>()
  private revision = 0
  private operation = 0
  private disposed = false
  candidate?: ResponseSelection
  editor?: ResponseEditor
  selectedId?: string
  selected?: ResponseAnnotationSnapshot
  failure?: AnnotationFailure
  busy = false

  constructor(readonly composer: ComposerBridge, private readonly load: (sessionId: string, seq: number) => Promise<void>) {}
  getSnapshot = (): number => this.revision
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  changed = (): void => { this.revision++; for (const listener of this.listeners) listener() }
  register(surface: ResponseSurface): () => void {
    this.surfaces.add(surface)
    this.changed()
    return () => { this.surfaces.delete(surface); this.changed() }
  }
  select(sessionId: string): void {
    if (this.busy || this.editor || this.composer.targetKey() !== sessionId) return
    const selection = window.getSelection()
    this.candidate = selection?.rangeCount === 1
      ? readResponseSelection(selection.getRangeAt(0), [...this.surfaces], sessionId) : undefined
    this.changed()
  }
  dismiss(restoreFocus = false): void {
    const editor = this.editor
    this.operation++
    this.candidate = undefined
    this.editor = undefined
    this.selectedId = undefined
    this.selected = undefined
    this.failure = undefined
    this.changed()
    if (restoreFocus && editor) {
      if (editor.trigger?.isConnected) editor.trigger.focus()
      else this.composer.responses?.focus(editor.snapshot.sessionId)
    }
  }
  async add(): Promise<void> {
    const selection = this.candidate
    if (!selection || this.busy) return
    const operation = ++this.operation
    this.failure = undefined
    this.busy = true
    this.changed()
    try {
      if (!selectionCurrent(selection)) throw new AnnotationError('error.responseChanged')
      await this.composer.add({ text: '', responseSelection: selection.snapshot, expectedTarget: selection.snapshot.sessionId, focus: false })
      if (this.disposed || operation !== this.operation || this.composer.targetKey() !== selection.snapshot.sessionId) return
      this.candidate = undefined
      window.getSelection()?.removeAllRanges()
      this.editor = { snapshot: selection.snapshot, initial: true }
      this.selectedId = selection.snapshot.id
      this.selected = selection.snapshot
    } catch (error) { if (operation === this.operation) { this.candidate = undefined; this.failure = annotationFailure(error) } }
    finally { this.busy = false; if (!this.disposed) this.changed() }
  }
  ranges(snapshot: ResponseAnnotationSnapshot): Range[] {
    const ranges = snapshot.anchors.map(anchor => {
      const surface = [...this.surfaces].find(item => item.source.sessionId === snapshot.sessionId && item.source.nodeKey === snapshot.nodeKey
        && item.source.blockIndex === anchor.blockIndex)
      return surface ? rangesForAnchor(projectResponseText(surface.root), anchor) : []
    })
    return ranges.every(part => part.length > 0) ? ranges.flat() : []
  }
  async open(snapshot: ResponseAnnotationSnapshot, edit: boolean, trigger?: HTMLElement): Promise<void> {
    if (this.composer.targetKey() !== snapshot.sessionId) throw new AnnotationError('error.sessionChangedAdd')
    const operation = ++this.operation
    if (edit) {
      snapshot = this.composer.responses?.read(snapshot.sessionId).find(item => item.id === snapshot.id) ?? snapshot
    }
    const unavailable = () => {
      if (!edit) throw new AnnotationError('error.responseUnavailable')
      this.candidate = undefined
      this.editor = { snapshot, initial: false, trigger }
      this.selectedId = snapshot.id
      this.selected = snapshot
      this.failure = new AnnotationError('error.responseUnavailable')
      this.changed()
    }
    try { await this.load(snapshot.sessionId, snapshot.seq) }
    catch { if (operation === this.operation && this.composer.targetKey() === snapshot.sessionId) unavailable(); return }
    for (let attempt = 0; attempt < 20; attempt++) {
      if (this.disposed || operation !== this.operation || this.composer.targetKey() !== snapshot.sessionId) throw new AnnotationError('error.cancelled')
      const surface = [...this.surfaces].find(item => item.source.sessionId === snapshot.sessionId && item.source.nodeKey === snapshot.nodeKey)
      if (surface) {
        surface.reveal()
        if (!this.ranges(snapshot).length) { unavailable(); return }
        surface.root.scrollIntoView({ block: 'center', behavior: 'instant' })
        this.candidate = undefined
        this.failure = undefined
        this.selectedId = snapshot.id
        this.selected = snapshot
        this.editor = edit ? { snapshot, initial: false, trigger } : undefined
        this.changed()
        return
      }
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    unavailable()
  }
  save(comment: string): void {
    if (!this.editor) return
    try {
      const snapshot = this.editor.snapshot
      this.composer.responses?.replace({ ...snapshot, comment })
      this.dismiss()
      this.composer.responses?.focus(snapshot.sessionId)
    } catch (error) { this.failure = annotationFailure(error); this.changed() }
  }
  remove(): void {
    if (!this.editor) return
    try {
      const snapshot = this.editor.snapshot
      this.composer.responses?.remove(snapshot.sessionId, snapshot.id)
      this.dismiss()
      this.composer.responses?.focus(snapshot.sessionId)
    } catch (error) { this.failure = annotationFailure(error); this.changed() }
  }
  dispose(): void { this.disposed = true; this.operation++; this.surfaces.clear(); this.listeners.clear() }
}
