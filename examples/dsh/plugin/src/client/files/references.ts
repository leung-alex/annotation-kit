/** DSH URI admission over the host-independent snapshot codec. */
import {
  AnnotationError, decodeFileReference as decode, fileReference as reference,
  serializeFileReference as serialize, readSentFile as readSent, selectedFiles as selected,
  assertFileDraftCapacity as assertCapacity,
  type FileSnapshot,
} from 'annotation-kit'
import { parseFileAddress } from '@deepseek-ai/dsh-util-workspace-path'
import type { InputState, ReferenceInsert } from '@deepseek-ai/dsh-client-ui-conversation/client'
export {
  FILE_SELECTION_SOURCE, MAX_SELECTION_BYTES, fileLocation, filePath, fileLabel,
  type TextSnapshot, type DocumentAnnotationSnapshot, type FileSnapshot,
} from 'annotation-kit'

export function decodeFileReference(ref: string): FileSnapshot | undefined {
  const snapshot = decode(ref)
  return snapshot && parseFileAddress(snapshot.address) ? snapshot : undefined
}
export function fileReference(snapshot: FileSnapshot): ReferenceInsert {
  if (!decodeFileReference(JSON.stringify(snapshot))) throw new AnnotationError('error.invalidSelection')
  return reference(snapshot)
}
export function assertFileDraftCapacity(input: InputState, ref: string): void { assertCapacity(input, ref) }
export function serializeFileReference(ref: string, signal: AbortSignal) {
  signal.throwIfAborted()
  if (!decodeFileReference(ref)) throw new AnnotationError('error.selectionDraft')
  return serialize(ref, signal)
}
export function readSentFile(block: unknown): FileSnapshot | undefined {
  const snapshot = readSent(block)
  return snapshot && parseFileAddress(snapshot.address) ? snapshot : undefined
}
export function selectedFiles(input: InputState) { return selected(input).filter(item => parseFileAddress(item.snapshot.address)) }
