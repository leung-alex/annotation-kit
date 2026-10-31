import type { BrowserSurfaceHandle } from '../shared/surface.ts'
import type { BrowserAnnotationSelection, DesktopAnnotations, DesktopAnnotationEvent } from '../shared/desktop.ts'
import type { ComposerBridge } from '../host-contracts.ts'
import type { AnnotationEntry } from './composer/packets.ts'
import { AnnotationError, annotationFailure, type AnnotationFailure } from './errors.ts'
export { formatAnnotations } from './composer/packets.ts'

export interface AnnotationDraft {
  readonly active: boolean
  readonly mode: 'element' | 'region'
  readonly lease: string
  readonly epoch: string
  readonly selection?: BrowserAnnotationSelection
  readonly comment: string
  readonly saving: boolean
  readonly error?: AnnotationFailure
  readonly target?: string
  readonly editing?: { readonly entry: AnnotationEntry; readonly commit: (comment: string) => void }
}

export interface AnnotationState {
  readonly drafts: Readonly<Record<string, AnnotationDraft>>
}

const emptyState: AnnotationState = { drafts: {} }

/** Window-local snapshots. Navigation only invalidates targets not yet saved. */
export class AnnotationsModel {
  private state: AnnotationState = emptyState
  private readonly listeners = new Set<() => void>()
  private readonly surfaces = new Map<string, BrowserSurfaceHandle>()
  private readonly operations = new Map<string, number>()
  private alive = true
  private nextId = 1
  private readonly visibleMarkers = new Set<number>()
  private readonly pending = new Map<string, AbortController>()
  private readonly unsubscribe: () => void

  constructor(private readonly desktop: DesktopAnnotations | undefined, private readonly composer: ComposerBridge,
    private readonly leaseOf: (surface: BrowserSurfaceHandle) => string | undefined = surface => {
      const viewport = document.getElementById(surface.viewportId)
      return viewport?.querySelector('webview')?.getAttribute('name') ?? undefined
    }) {
    this.unsubscribe = desktop?.subscribe(event => this.receive(event)) ?? (() => {})
  }

  readonly getSnapshot = (): AnnotationState => this.state
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  readonly refresh = (): void => {
    for (const [id, draft] of Object.entries(this.state.drafts)) {
      if (draft.selection && draft.target !== this.composer.targetKey()) {
        this.nextOperation(id)
        this.update(id, { ...draft, selection: undefined, saving: false, comment: '', error: undefined })
      }
    }
    this.publish({ ...this.state })
  }
  available(surface: BrowserSurfaceHandle): boolean {
    return this.alive && this.desktop?.protocolVersion === 1 && surface.enabled && !surface.signal?.aborted
  }
  hasTarget(): boolean { return this.composer.hasTarget() }
  controls() { return this.composer.annotationControls?.() }
  markerVisible(id: number): boolean { return this.visibleMarkers.has(id) }

  readonly edit = (entry: AnnotationEntry, commit: (comment: string) => void): boolean => {
    const surface = entry.surfaceId ? this.surfaces.get(entry.surfaceId) : undefined
    if (!surface || !this.available(surface) || surface.url !== entry.selection.url || !this.visibleMarkers.has(entry.id)) return false
    const draft = this.state.drafts[surface.id]
    if (!draft?.active) return false
    this.update(surface.id, { ...draft, selection: entry.selection, comment: entry.comment,
      target: this.composer.targetKey(), editing: { entry, commit }, error: undefined })
    return true
  }

  async toggle(surface: BrowserSurfaceHandle): Promise<void> {
    const draft = this.state.drafts[surface.id]
    if (draft?.active) {
      this.nextOperation(surface.id)
      this.update(surface.id, { ...draft, active: false, selection: undefined, saving: false, comment: '' })
      await this.desktop?.setMode(draft.lease, 'off').catch(() => {})
      return
    }
    if (!this.available(surface)) return
    const lease = this.leaseOf(surface)
    const operation = this.nextOperation(surface.id)
    this.surfaces.set(surface.id, surface)
    const starting: AnnotationDraft = {
      active: true, mode: 'element', lease: lease ?? '', epoch: '', comment: draft?.comment ?? '', saving: false,
    }
    this.update(surface.id, starting)
    if (!lease) { this.update(surface.id, { ...starting, error: new AnnotationError('error.browserNotReady') }); return }
    try {
      const response = await this.desktop!.setMode(lease, 'element')
      const latest = this.currentOperation(surface, operation, lease)
      if (latest) this.update(surface.id, { ...latest, epoch: response.documentEpoch, error: undefined })
    } catch (error) {
      const latest = this.currentOperation(surface, operation, lease)
      if (latest) this.update(surface.id, { ...latest, error: annotationFailure(error) })
    }
  }

  async setMode(surface: BrowserSurfaceHandle, mode: 'element' | 'region'): Promise<void> {
    const current = this.state.drafts[surface.id]
    if (!current?.active || current.saving || !this.available(surface)) return
    const operation = this.nextOperation(surface.id)
    try {
      const response = await this.desktop!.setMode(current.lease, mode)
      const latest = this.currentOperation(surface, operation, current.lease)
      if (latest) this.update(surface.id, { ...latest, mode, epoch: response.documentEpoch, selection: undefined, error: undefined })
    } catch (error) {
      const latest = this.currentOperation(surface, operation, current.lease)
      if (latest) this.update(surface.id, { ...latest, error: annotationFailure(error) })
    }
  }

  setComment(surfaceId: string, comment: string): void {
    const draft = this.state.drafts[surfaceId]
    if (draft) this.update(surfaceId, { ...draft, comment })
  }

  cancel(surfaceId: string): void {
    const draft = this.state.drafts[surfaceId]
    if (!draft) return
    this.nextOperation(surfaceId)
    this.update(surfaceId, { ...draft, selection: undefined, comment: '', saving: false, editing: undefined, error: undefined })
    void this.desktop?.setMode(draft.lease, draft.mode).catch(() => {})
  }

  async save(surface: BrowserSurfaceHandle): Promise<void> {
    const draft = this.state.drafts[surface.id]
    if (!draft?.selection || !draft.epoch || draft.saving || !draft.comment.trim() || !this.available(surface)) return
    const operation = this.operations.get(surface.id)
    if (!draft.target || draft.target !== this.composer.targetKey()) {
      this.update(surface.id, { ...draft, error: new AnnotationError('error.originalSession') })
      return
    }
    if (draft.editing) {
      draft.editing.commit(draft.comment)
      this.cancel(surface.id)
      return
    }
    const controller = new AbortController()
    this.pending.set(surface.id, controller)
    const id = this.nextId++
    const pending = { ...draft, saving: true, error: undefined }
    this.update(surface.id, pending)
    try {
      const captured = await this.desktop!.capture(draft.lease, draft.epoch, draft.selection, id)
      const latest = operation === undefined ? undefined : this.currentOperation(surface, operation, draft.lease)
      if (!latest?.saving || latest.epoch !== draft.epoch) return
      const image = new File([new Uint8Array(captured.png)], `annotation-${crypto.randomUUID()}-${id}.png`, { type: 'image/png' })
      const entry = { id, source: surface.source, surfaceId: surface.id, selection: draft.selection, comment: draft.comment, image }
      await this.composer.add({ text: '', annotations: [entry], images: [image], expectedTarget: draft.target,
        signal: controller.signal, focus: false })
      if (controller.signal.aborted || !this.currentOperation(surface, operation!, draft.lease)) return
      this.visibleMarkers.add(id)
      this.update(surface.id, { ...latest, saving: false, selection: undefined, comment: '' })
      void this.desktop?.setMode(draft.lease, draft.mode).catch(() => {})
    } catch (error) {
      const latest = operation === undefined ? undefined : this.currentOperation(surface, operation, draft.lease)
      if (latest?.saving && latest.epoch === draft.epoch) this.update(surface.id, { ...latest, saving: false, error: annotationFailure(error) })
    } finally { if (this.pending.get(surface.id) === controller) this.pending.delete(surface.id) }
  }

  dispose(): void {
    this.alive = false
    for (const controller of this.pending.values()) controller.abort()
    this.pending.clear()
    this.unsubscribe()
    for (const draft of Object.values(this.state.drafts)) {
      if (draft.active && draft.lease) void this.desktop?.setMode(draft.lease, 'off').catch(() => {})
    }
    this.listeners.clear()
    this.surfaces.clear()
    this.operations.clear()
    this.state = emptyState
  }

  private receive(event: DesktopAnnotationEvent): void {
    if (!this.alive) return
    if (event.kind === 'identity-cleared') {
      const drafts = { ...this.state.drafts }
      for (const [id, surface] of this.surfaces) if (surface.source === event.source) {
        this.nextOperation(id)
        delete drafts[id]
        this.surfaces.delete(id)
      }
      this.publish({ ...this.state, drafts })
      return
    }
    for (const [id, draft] of Object.entries(this.state.drafts)) {
      if (draft.lease !== event.lease) continue
      if (event.kind !== 'selection') {
        for (const entry of this.controls()?.entries ?? []) if (entry.surfaceId === id) this.visibleMarkers.delete(entry.id)
        this.nextOperation(id)
        this.update(id, { ...draft, active: event.kind === 'selection-cleared' && draft.active,
          selection: undefined, saving: false, editing: undefined, epoch: event.documentEpoch })
      } else if (draft.active && !draft.saving && draft.epoch === event.documentEpoch) {
        this.update(id, { ...draft, selection: event.selection, target: this.composer.targetKey(), comment: '', editing: undefined, error: undefined })
      }
    }
  }

  private update(id: string, draft: AnnotationDraft): void {
    this.publish({ ...this.state, drafts: { ...this.state.drafts, [id]: draft } })
  }
  private nextOperation(id: string): number {
    this.pending.get(id)?.abort()
    this.pending.delete(id)
    const next = (this.operations.get(id) ?? 0) + 1
    this.operations.set(id, next)
    return next
  }
  private currentOperation(surface: BrowserSurfaceHandle, operation: number, lease: string): AnnotationDraft | undefined {
    const draft = this.state.drafts[surface.id]
    return this.alive && !surface.signal?.aborted && this.operations.get(surface.id) === operation
      && draft?.active && draft.lease === lease ? draft : undefined
  }
  private publish(state: AnnotationState): void {
    if (!this.alive) return
    this.state = state
    for (const listener of this.listeners) listener()
  }
}
