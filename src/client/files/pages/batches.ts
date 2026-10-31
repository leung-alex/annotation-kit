import { AnnotationError } from '../../errors.ts'
import { decodeFileReference, fileReference } from '../references.ts'
import { pageImageStore, type PageImageStore } from './image-store.ts'
import type { DocumentAnnotationSnapshot } from '../references.ts'

/** Document requests are separate from Composer drafts and scoped to session + source. */
export class PageBatches {
  private revision = 0
  private listeners = new Set<() => void>()
  constructor(private images: PageImageStore = pageImageStore(), private storage: () => Storage = () => localStorage, private namespace = 'annotation-kit.document-annotations.v1') {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  getSnapshot = () => this.revision
  private key(session: string, address: string) { return `${this.namespace}:${session}:${address}` }
  read(session: string, address: string): readonly DocumentAnnotationSnapshot[] {
    const text = this.storage().getItem(this.key(session, address))
    if (!text) return []
    if (new TextEncoder().encode(text).length > 512 * 1024) throw new AnnotationError('error.batchLimit')
    const data: unknown = JSON.parse(text)
    if (!Array.isArray(data) || data.length > 32) throw new AnnotationError('error.invalidBatch')
    return data.map(value => {
      const snapshot = decodeFileReference(JSON.stringify(value))
      if (!snapshot || snapshot.version === 1 || !snapshot.comment || snapshot.address !== address) throw new AnnotationError('error.invalidBatch')
      return snapshot
    })
  }
  private write(session: string, address: string, items: readonly DocumentAnnotationSnapshot[]) {
    const text = JSON.stringify(items)
    if (items.length > 32 || new TextEncoder().encode(text).length > 512 * 1024) throw new AnnotationError('error.batchFull')
    if (items.length) this.storage().setItem(this.key(session, address), text)
    else this.storage().removeItem(this.key(session, address))
    this.revision++
    for (const listener of this.listeners) listener()
  }
  async save(session: string, snapshot: DocumentAnnotationSnapshot, image?: File, signal?: AbortSignal) {
    fileReference(snapshot)
    if (!snapshot.comment) throw new AnnotationError('error.commentRequired')
    signal?.throwIfAborted()
    if (image && (snapshot.version !== 2 || !snapshot.image || image.name !== snapshot.image.name)) throw new AnnotationError('error.imageMismatch')
    let stored = false
    try {
      if (image) { await this.images.put(snapshot.id, image); stored = true }
      signal?.throwIfAborted()
      const items = this.read(session, snapshot.address)
      if (snapshot.version === 2 && snapshot.image && !image && !items.some(item => item.id === snapshot.id)) throw new AnnotationError('error.imageMissing')
      this.write(session, snapshot.address, items.some(item => item.id === snapshot.id)
        ? items.map(item => item.id === snapshot.id ? snapshot : item) : [...items, snapshot])
    } catch (error) {
      if (stored) await this.images.remove(snapshot.id).catch(() => undefined)
      throw error
    }
  }
  async remove(session: string, address: string, ids: readonly string[]) {
    const items = this.read(session, address), removed = items.filter(item => ids.includes(item.id))
    this.write(session, address, items.filter(item => !ids.includes(item.id)))
    // Metadata is committed first. A failed blob cleanup can only leave an orphan, never a broken draft.
    await Promise.all(removed.filter(item => item.version === 2 && item.image).map(item => this.images.remove(item.id).catch(() => undefined)))
  }
  async acknowledge(session: string, address: string, sent: readonly DocumentAnnotationSnapshot[]) {
    const payloads = new Map(sent.map(item => [item.id, JSON.stringify(item)]))
    const ids = this.read(session, address).filter(item => payloads.get(item.id) === JSON.stringify(item)).map(item => item.id)
    await this.remove(session, address, ids)
  }
  async files(items: readonly DocumentAnnotationSnapshot[], signal: AbortSignal) {
    const files: File[] = []
    for (const item of items) {
      signal.throwIfAborted()
      if (item.version !== 2 || !item.image) continue
      const file = await this.images.get(item.id, item.image.name)
      if (!file) throw new AnnotationError('error.regionUnavailable')
      files.push(file)
    }
    signal.throwIfAborted()
    return files
  }
}
