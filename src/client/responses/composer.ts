import type { ResponseAnnotationSnapshot } from './references.ts'

/** The persisted Composer document owns these items; no parallel window-local draft store. */
export interface ResponseComposer {
  read(sessionId: string): readonly ResponseAnnotationSnapshot[]
  replace(snapshot: ResponseAnnotationSnapshot): void
  remove(sessionId: string, id: string): void
  clear(sessionId: string): void
  focus(sessionId: string): void
  open?: (snapshot: ResponseAnnotationSnapshot, edit: boolean, trigger?: HTMLElement) => Promise<void>
}
