import type { AnnotationEntry } from './client/composer/packets.ts'
import type { FileSnapshot, DocumentAnnotationSnapshot } from './client/files/references.ts'
import type { ResponseAnnotationSnapshot } from './client/responses/references.ts'
import type { ResponseComposer } from './client/responses/composer.ts'
import type { AnnotationKey } from './client/locales.ts'

/** Host ids remain opaque; no application or editor runtime is imported. */
export type SessionId = string
export type DraftAttachmentId = string
export interface TokenSpan { readonly start: number; readonly end: number; readonly draftRev: number }
export interface ReferenceInsert { readonly source: string; readonly ref: string; readonly label: string; readonly clipboardText: string }
export interface ReferenceOccurrence { readonly id?: string; readonly source: string; readonly ref: string; readonly offset: number; readonly length: number; readonly label?: string }
export interface InputState {
  readonly phase: string
  readonly draft: string
  readonly draftRev: number
  readonly attachmentIds: readonly DraftAttachmentId[]
  readonly occurrences: readonly ReferenceOccurrence[]
}
export interface InputActions {
  captureInsertion(): TokenSpan
  addAttachments(ids: readonly DraftAttachmentId[]): boolean
  removeAttachment(id: DraftAttachmentId): unknown
  insertText(text: string, span?: TokenSpan): boolean
}
export interface ComposerAttachment { readonly id: DraftAttachmentId; readonly kind: string; readonly file: File }
export interface PageSendRequest {
  readonly items: readonly DocumentAnnotationSnapshot[]
  readonly images: readonly File[]
  readonly expectedTarget: string
  readonly signal: AbortSignal
}
export interface ComposerAddRequest {
  readonly text: string
  readonly images?: readonly File[]
  readonly annotations?: readonly AnnotationEntry[]
  readonly fileSelection?: FileSnapshot
  readonly responseSelection?: ResponseAnnotationSnapshot
  readonly signal?: AbortSignal
  readonly expectedTarget?: string
  readonly focus?: boolean
}
export interface ComposerBridge {
  readonly responses?: ResponseComposer
  sendPages?(request: PageSendRequest): Promise<void>
  annotationControls?(): { count: number; entries: readonly AnnotationEntry[]; edit(id: number): void; remove(id: number): void; review(): void; clear(): void; send(): void }
  editAnnotation?: (entry: AnnotationEntry, commit: (comment: string) => void) => boolean
  add(request: ComposerAddRequest): Promise<void>
  hasTarget(): boolean
  targetKey(): string | undefined
  subscribe(listener: () => void): () => void
  dispose(): void
}
export interface PropsLocale<N extends string = 'annotations'> {
  t(key: N extends 'annotations' ? AnnotationKey : string, values?: Record<string, string | number>): string
}
export interface FileActionProps {
  readonly content: { readonly kind: string; readonly text?: string; readonly data?: Uint8Array; readonly eof?: boolean }
  useTabInfo(): { readonly tab: { readonly id: string; readonly contentId: string; readonly signal: AbortSignal; readonly navigation: { readonly params?: { readonly url?: string } } } }
}
