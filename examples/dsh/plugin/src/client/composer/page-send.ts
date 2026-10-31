import { AnnotationError } from '../errors.ts'
import type { SessionFace } from '@deepseek-ai/dsh-api-session-controller/client'
import type { DraftAttachmentId, SubmitOutcome } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { fileReference, serializeFileReference } from '../files/references.ts'
import type { DocumentAnnotationSnapshot } from '../files/references.ts'
import { draftFactory, imageDrafts } from './attachments.ts'

interface Sender {
  sendSession(session: SessionFace, text: string, ids: readonly DraftAttachmentId[], mode: 'queue', signal: AbortSignal,
    blocks: Parameters<SessionFace['beginSubmission']>[0]['textBlocks']): Promise<SubmitOutcome>
}
export interface PageSendRequest {
  readonly items: readonly DocumentAnnotationSnapshot[]
  readonly images: readonly File[]
  readonly expectedTarget: string
  readonly signal: AbortSignal
}

/** Version-bound adapter to DSH's standard attachment admission, without touching the Composer. */
export async function sendPageBatch(conversation: unknown, session: SessionFace, request: PageSendRequest) {
  const { items, images, signal } = request
  signal.throwIfAborted()
  if (!items.length || items.length > 32 || items.some(item => !item.comment?.trim())) throw new AnnotationError('error.invalidDocument')
  const owned = items.flatMap(item => item.version === 2 && item.image ? [item.image] : [])
  if (owned.length !== images.length || owned.some((image, index) => image.name !== images[index]?.name)) throw new AnnotationError('error.imageMismatch')
  const blocks = items.map(item => ({ type: 'text' as const, ...serializeFileReference(fileReference(item).ref, signal) }))
  const text = blocks.map(block => block.text).join('\n\n')
  if (new TextEncoder().encode(text).length > 512 * 1024) throw new AnnotationError('error.batchLimit')
  if (!conversation || typeof conversation !== 'object' || !('sendSession' in conversation) || typeof conversation.sendSession !== 'function') {
    throw new AnnotationError('error.senderUnsupported')
  }
  const factory = draftFactory(conversation)
  const ids = images.length ? imageDrafts(factory, session.sessionId, images) : []
  try {
    signal.throwIfAborted()
    const outcome = await (conversation as Sender).sendSession(session, text, ids, 'queue', signal, blocks)
    if (outcome.kind !== 'success') throw outcome.kind === 'error' && outcome.text ? new Error(outcome.text) : new AnnotationError('error.sendFailed')
  } finally {
    for (const id of ids) factory.releaseDraftAttachment(id)
  }
}
