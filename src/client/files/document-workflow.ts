import { AnnotationError } from '../errors.ts'
import { parseFileAddress } from '../../address.ts'
import type { ComposerBridge } from '../../host-contracts.ts'
import type { DocumentAnnotationSnapshot } from './references.ts'
import type { PageSnapshot } from './pages/snapshot.ts'
import { PageBatches } from './pages/batches.ts'

/** Document callers cannot insert or submit the unrelated Composer draft. */
export type DocumentAnnotationBridge = Pick<ComposerBridge, 'targetKey' | 'subscribe' | 'sendPages'>
export interface DocumentScope { readonly session: string; readonly address: string }
export type DocumentCommit =
  | { readonly kind: 'batch'; readonly snapshot: DocumentAnnotationSnapshot; readonly image?: File | undefined }
  | { readonly kind: 'presentation-request'; readonly snapshot: PageSnapshot; readonly image?: never }

/** One owner for durable saves, independent sends, retries and exact-batch acknowledgement. */
export class DocumentWorkflow {
  readonly canSend: boolean
  private readonly sender: ComposerBridge['sendPages']
  private readonly active = new Set<string>()

  constructor(private readonly bridge: DocumentAnnotationBridge, private readonly batches: PageBatches) {
    this.sender = typeof bridge.sendPages === 'function' ? bridge.sendPages.bind(bridge) : undefined
    this.canSend = this.sender !== undefined
  }

  private assertScope(scope: DocumentScope, signal: AbortSignal) {
    signal.throwIfAborted()
    if (!scope.session || this.bridge.targetKey() !== scope.session) throw new AnnotationError('error.sessionChangedDocument')
  }

  private async exclusive(scope: DocumentScope, signal: AbortSignal, task: () => Promise<void>) {
    this.assertScope(scope, signal)
    const key = JSON.stringify([scope.session, scope.address])
    if (this.active.has(key)) throw new AnnotationError('error.documentBusy')
    this.active.add(key)
    try { await task() } finally { this.active.delete(key) }
  }

  async commit(scope: DocumentScope, request: DocumentCommit, signal: AbortSignal) {
    return this.exclusive(scope, signal, async () => {
      if (request.snapshot.address !== scope.address) throw new AnnotationError('error.fileChanged')
      if (request.kind === 'batch') {
        await this.batches.save(scope.session, request.snapshot, request.image, signal)
        return
      }
      if (!/\.pptx?$/iu.test(parseFileAddress(scope.address)?.path ?? '') || request.snapshot.kind !== 'office'
        || request.snapshot.image || request.snapshot.region) throw new AnnotationError('error.quickTextOnly')
      if (!this.sender) throw new AnnotationError('error.senderUnavailable')
      await this.sender({ items: [request.snapshot], images: [], expectedTarget: scope.session, signal })
    })
  }

  async send(scope: DocumentScope, signal: AbortSignal) {
    return this.exclusive(scope, signal, async () => {
      if (!this.sender) throw new AnnotationError('error.senderUnavailable')
      const items = this.batches.read(scope.session, scope.address)
      if (!items.length) return
      const images = await this.batches.files(items, signal)
      this.assertScope(scope, signal)
      await this.sender({ items, images, expectedTarget: scope.session, signal })
      // Successful admission owns this captured payload, even if the view changed.
      // A newer edit with the same ID must remain an unsent durable draft.
      await this.batches.acknowledge(scope.session, scope.address, items)
    })
  }

  async remove(scope: DocumentScope, ids: readonly string[], signal: AbortSignal) {
    return this.exclusive(scope, signal, () => this.batches.remove(scope.session, scope.address, ids))
  }
}
