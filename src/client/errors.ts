import { errorZh, type AnnotationErrorKey } from './error-copy.ts'

export class AnnotationError extends Error {
  constructor(readonly key: AnnotationErrorKey, options?: ErrorOptions) {
    // Preserve existing diagnostic messages; UI and outgoing errors use the active locale.
    super(errorZh[key], options)
  }
}

export type AnnotationFailure = Error | string
export const annotationFailure = (error: unknown): AnnotationFailure => error instanceof Error ? error : String(error)

/** Keep failure identity until render so an already-visible error follows language changes. */
export function annotationErrorText(error: AnnotationFailure, t: (key: AnnotationErrorKey) => string): string {
  return error instanceof AnnotationError ? t(error.key) : error instanceof Error ? error.message : error
}
