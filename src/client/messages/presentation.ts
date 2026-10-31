/** Versioned, JSON-safe sent-message presentation. Model evidence stays in text. */
export const ANNOTATION_PRESENTATION = 'aione-annotations'

export type SentAnnotation = {
  readonly id: number
  readonly comment: string
  readonly title: string
  readonly url: string
  readonly target: string
  readonly screenshot: string
}

export interface AnnotationPresentation {
  readonly source: typeof ANNOTATION_PRESENTATION
  readonly summary: string
  readonly data: { readonly version: 1; readonly id: string; readonly entries: readonly SentAnnotation[] }
}
export interface SerializedAnnotation { readonly text: string; readonly presentation: AnnotationPresentation }

export function annotationPresentation(id: string, entries: readonly {
  readonly id: number; readonly comment: string; readonly image: { readonly name: string }
  readonly selection: { readonly title: string; readonly url: string; readonly selector?: string; readonly kind: string }
}[]): AnnotationPresentation {
  return { source: ANNOTATION_PRESENTATION, summary: entries.map(entry => entry.comment).join(' · ').slice(0, 4096), data: { version: 1, id, entries: entries.map(entry => ({
    id: entry.id, comment: entry.comment, title: entry.selection.title, url: entry.selection.url,
    target: entry.selection.selector ?? entry.selection.kind, screenshot: entry.image.name,
  })) } }
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Only explicit v1 metadata opts in. Plain text, legacy dumps and unknown versions stay untouched. */
export function readAnnotation(block: unknown): SerializedAnnotation | undefined {
  if (!record(block) || block.type !== 'text' || typeof block.text !== 'string') return undefined
  const presentation = block.presentation
  if (!record(presentation) || presentation.source !== ANNOTATION_PRESENTATION) return undefined
  const data = presentation.data
  if (!record(data) || data.version !== 1 || typeof data.id !== 'string' || !Array.isArray(data.entries)
    || data.entries.length === 0 || data.entries.length > 100) return undefined
  if (!data.entries.every((entry: unknown) => record(entry)
    && Number.isSafeInteger(entry.id) && typeof entry.id === 'number' && entry.id > 0
    && ['comment', 'title', 'url', 'target', 'screenshot'].every(key => typeof entry[key] === 'string')
    && typeof entry.screenshot === 'string' && entry.screenshot.length > 0)) return undefined
  return block as unknown as SerializedAnnotation
}
