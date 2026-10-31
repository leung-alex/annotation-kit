import { AnnotationError } from '../errors.ts'
import type { SessionId } from '../../host-contracts.ts'
import type { ComposerAttachment, DraftAttachmentId } from '../../host-contracts.ts'

export interface DraftFactory {
  createDrafts(sessionId: SessionId, files: readonly File[]): readonly ComposerAttachment[]
  releaseDraftAttachment(id: DraftAttachmentId): void
  resolveDraftAttachments(ids: readonly DraftAttachmentId[]): readonly ComposerAttachment[]
}

export function draftFactory(value: unknown): DraftFactory {
  // Concrete adapter pinned to accepted DSH 687f282e8625c6b8d11ff58211a90524be2e4317.
  if (typeof value !== 'object' || value === null
    || !('createDrafts' in value) || typeof value.createDrafts !== 'function'
    || !('releaseDraftAttachment' in value) || typeof value.releaseDraftAttachment !== 'function'
    || !('resolveDraftAttachments' in value) || typeof value.resolveDraftAttachments !== 'function') {
    throw new AnnotationError('error.imageDraftUnsupported')
  }
  return value as DraftFactory
}

export function imageDrafts(factory: DraftFactory, id: SessionId, images: readonly File[]): readonly DraftAttachmentId[] {
  const returned: unknown = factory.createDrafts(id, images)
  const drafts = Array.isArray(returned) ? returned as ComposerAttachment[] : []
  const ids = drafts.flatMap(draft => typeof draft?.id === 'string' ? [draft.id] : [])
  if (drafts.length !== images.length || drafts.some((draft, index) => draft.kind !== 'image' || draft.file !== images[index])) {
    for (const draftId of ids) factory.releaseDraftAttachment(draftId)
    throw new AnnotationError('error.imageDraftIncompatible')
  }
  return ids
}
