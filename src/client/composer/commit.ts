import { AnnotationError } from '../errors.ts'
import type { DraftAttachmentId, InputActions } from '../../host-contracts.ts'

/** Admission is synchronous: neither a new selection nor a model switch can interleave. */
export function commitToComposer(
  actions: InputActions,
  text: string,
  ids: readonly DraftAttachmentId[],
  current: () => boolean,
  release: (id: DraftAttachmentId) => void,
  insert?: (span: ReturnType<InputActions['captureInsertion']>) => boolean,
): void {
  let attached = false
  try {
    if (!current()) throw new AnnotationError('error.sessionChangedAdd')
    if (ids.length > 0 && !actions.addAttachments(ids)) throw new AnnotationError('error.composerImages')
    attached = ids.length > 0
    if (!current()) throw new AnnotationError('error.sessionChangedAdd')
    const span = actions.captureInsertion()
    if (!current()) throw new AnnotationError('error.sessionChangedAdd')
    if (!(insert ? insert(span) : actions.insertText(text, span))) throw new AnnotationError('error.draftChanged')
  } catch (error) {
    if (attached) for (const id of ids) actions.removeAttachment(id)
    for (const id of ids) release(id)
    throw error
  }
}
