/** Capabilities exposed only to the host's trusted application renderer. */
export interface AnnotationRect {
  x: number
  y: number
  width: number
  height: number
}

export interface BrowserAnnotationSelection {
  kind: 'element' | 'region'
  selector?: string
  text?: string
  element?: BrowserAnnotationElement
  rect: AnnotationRect
  viewport: { width: number; height: number }
  scroll: { x: number; y: number }
  url: string
  title: string
  anchor?: { x: number; y: number }
}

export interface BrowserAnnotationControl {
  tagName: string
  role?: string
  attributes: Readonly<Record<string, string>>
}

export interface BrowserAnnotationElement extends BrowserAnnotationControl {
  path: string
  frame: string
  controls?: readonly BrowserAnnotationControl[]
}

export type DesktopAnnotationEvent =
  | { lease: string; documentEpoch: string; kind: 'selection'; source: string; selection: BrowserAnnotationSelection }
  | { lease: string; documentEpoch: string; kind: 'navigation' | 'disposed'; source: string }
  | { lease: string; documentEpoch: string; kind: 'selection-cleared' | 'mode-ended'; source: string }
  | { lease: ''; documentEpoch: ''; kind: 'identity-cleared'; source: string }

export interface DesktopAnnotations {
  readonly protocolVersion: 1
  subscribe(listener: (event: DesktopAnnotationEvent) => void): () => void
  setMode(lease: string, mode: 'off' | 'element' | 'region'): Promise<{ documentEpoch: string }>
  capture(lease: string, documentEpoch: string, selection: BrowserAnnotationSelection, number: number): Promise<{
    png: Uint8Array
    width: number
    height: number
    viewportWidth: number
    viewportHeight: number
  }>
}
