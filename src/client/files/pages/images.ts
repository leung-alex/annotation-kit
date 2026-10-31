import { AnnotationError, type AnnotationFailure } from '../../errors.ts'
import type { SessionId } from '../../../host-contracts.ts'
import type { DraftAttachmentId, InputActions, InputState } from '../../../host-contracts.ts'
import { imageDrafts, type DraftFactory } from '../../composer/attachments.ts'
import { selectedFiles, type FileSnapshot } from '../references.ts'
import { pageImageStore, type PageImageStore } from './image-store.ts'
import type { PageSnapshot } from './snapshot.ts'

interface Entry {
  session: SessionId
  snapshot: PageSnapshot
  ids: readonly DraftAttachmentId[]
  factory: DraftFactory
  file?: File
  url?: string
  error?: AnnotationFailure
  staged: boolean
}

/** Own screenshot admission together with its semantic reference, including undo and restoration. */
export class PageImages {
  private entries = new Map<string, Entry>()
  private listeners = new Set<() => void>()
  private revision = 0
  private disposed = false
  constructor(private readonly store: PageImageStore = pageImageStore()) {}
  readonly subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  readonly getSnapshot = () => this.revision
  private changed() { this.revision++; for (const listener of this.listeners) listener() }
  preview(snapshot: FileSnapshot) { return this.entries.get(snapshot.id) }

  async save(snapshot: PageSnapshot, file: File, signal?: AbortSignal) {
    if (!snapshot.image || file.name !== snapshot.image.name || file.type !== 'image/png') throw new AnnotationError('error.pageImageMismatch')
    signal?.throwIfAborted()
    await this.store.put(snapshot.id, file)
    if (signal?.aborted || this.disposed) { await this.store.remove(snapshot.id); throw new AnnotationError('error.cancelled') }
  }
  stage(session: SessionId, snapshot: PageSnapshot, file: File, factory: DraftFactory, ids: readonly DraftAttachmentId[]) {
    this.entries.set(snapshot.id, { session, snapshot, file, factory, ids, staged: true, url: URL.createObjectURL(file) })
  }
  activate(id: string) { const entry = this.entries.get(id); if (entry) entry.staged = false; this.changed() }
  validate(snapshot: FileSnapshot) {
    if (snapshot.version !== 2 || !snapshot.image) return
    const entry = this.entries.get(snapshot.id)
    if (!entry?.file || entry.ids.length !== 1 || entry.factory.resolveDraftAttachments(entry.ids)[0]?.file !== entry.file) {
      throw entry?.error ?? new AnnotationError('error.imageRestoring')
    }
  }
  imageIdsFor(input: InputState | undefined) {
    return new Set(input ? selectedFiles(input).flatMap(({ snapshot }) => this.entries.get(snapshot.id)?.ids ?? []) : [])
  }
  reconcile(session: SessionId, input: InputState, actions: InputActions, factory: DraftFactory) {
    if (this.disposed || input.phase !== 'plain') return
    const active = new Map(selectedFiles(input).flatMap(({ snapshot }) => snapshot.version === 2 && snapshot.image ? [[snapshot.id, snapshot] as const] : []))
    for (const [id, snapshot] of active) {
      if (this.entries.has(id)) continue
      const entry: Entry = { session, snapshot, factory, ids: [], staged: false }
      this.entries.set(id, entry)
      void this.store.get(id, snapshot.image!.name).then(file => {
        if (this.disposed || this.entries.get(id) !== entry) return
        if (!file) throw new AnnotationError('error.imageDraftLost')
        entry.file = file; entry.url = URL.createObjectURL(file); this.changed()
      }).catch(error => {
        if (this.disposed || this.entries.get(id) !== entry) return
        entry.error = error instanceof Error ? error : new AnnotationError('error.restoreImage'); this.changed()
      })
    }
    for (const [id, entry] of this.entries) {
      if (entry.session !== session || entry.staged) continue
      if (active.has(id)) {
        if (entry.file && !entry.ids.length && !entry.error) {
          entry.staged = true
          try {
            const ids = imageDrafts(factory, session, [entry.file])
            entry.ids = ids
            if (!actions.addAttachments(ids)) throw new AnnotationError('error.restoreAttachmentRetry')
          } catch (error) {
            for (const imageId of entry.ids) factory.releaseDraftAttachment(imageId)
            entry.ids = []
            entry.error = error instanceof Error ? error : new AnnotationError('error.restoreAttachment')
          } finally { entry.staged = false }
          this.changed()
        }
      } else if (entry.ids.some(imageId => input.attachmentIds.includes(imageId))) {
        const ids = entry.ids; entry.ids = []
        for (const imageId of ids) { actions.removeAttachment(imageId); factory.releaseDraftAttachment(imageId) }
        this.changed()
      } else if (entry.ids.length && !factory.resolveDraftAttachments(entry.ids).length) {
        // Successful sends have durable Host images and cut editor undo history.
        this.discard(id)
        void this.store.remove(id).catch(() => undefined)
      }
    }
  }
  discard(id: string) {
    const entry = this.entries.get(id)
    if (entry?.url) URL.revokeObjectURL(entry.url)
    this.entries.delete(id); this.changed()
  }
  async cancel(id: string) { this.discard(id); await this.store.remove(id) }
  dispose() {
    this.disposed = true
    for (const entry of this.entries.values()) if (entry.url) URL.revokeObjectURL(entry.url)
    this.entries.clear(); this.listeners.clear()
  }
}
