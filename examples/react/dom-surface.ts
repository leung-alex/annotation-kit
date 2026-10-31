import html2canvas from 'html2canvas'
import type { DesktopAnnotations, DesktopAnnotationEvent, BrowserAnnotationSelection } from 'annotation-kit'

/** A same-document browser host, using DOM rasterization rather than Electron capturePage. */
export class DomSurface implements DesktopAnnotations {
  readonly protocolVersion = 1
  mode: 'off' | 'element' | 'region' = 'off'
  private epoch = crypto.randomUUID()
  private listeners = new Set<(event: DesktopAnnotationEvent) => void>()
  constructor(readonly root: HTMLElement) {}
  subscribe = (listener: (event: DesktopAnnotationEvent) => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  async setMode(_lease: string, mode: typeof this.mode) { this.mode = mode; this.root.dataset.mode = mode; return { documentEpoch: this.epoch } }
  select(target: HTMLElement, rect = target.getBoundingClientRect(), kind: 'element' | 'region' = 'element') {
    if (this.mode === 'off') return
    const bounds = this.root.getBoundingClientRect()
    const selection: BrowserAnnotationSelection = { kind, selector: target.id ? `#${target.id}` : target.tagName.toLowerCase(), text: target.textContent?.trim().slice(0, 2048),
      element: { tagName: target.tagName.toLowerCase(), path: target.id ? `#${target.id}` : target.tagName.toLowerCase(), frame: 'top document', attributes: {} },
      rect: { x: rect.x - bounds.x, y: rect.y - bounds.y, width: rect.width, height: rect.height },
      viewport: { width: bounds.width, height: bounds.height }, scroll: { x: 0, y: 0 }, url: location.href, title: 'Orbit · Launch checklist' }
    for (const listener of this.listeners) listener({ kind: 'selection', source: 'browser', lease: 'demo', documentEpoch: this.epoch, selection })
  }
  async capture(_lease: string, epoch: string, selection: BrowserAnnotationSelection, number: number) {
    if (epoch !== this.epoch) throw new Error('Page changed')
    const canvas = await html2canvas(this.root, { backgroundColor: '#fff', scale: 1, logging: false })
    const context = canvas.getContext('2d')!
    context.strokeStyle = '#3986f6'; context.lineWidth = 2
    context.strokeRect(selection.rect.x, selection.rect.y, selection.rect.width, selection.rect.height)
    context.fillStyle = '#3986f6'; context.beginPath(); context.arc(selection.rect.x + 12, selection.rect.y + 12, 12, 0, Math.PI * 2); context.fill()
    context.fillStyle = '#fff'; context.font = 'bold 13px sans-serif'; context.textAlign = 'center'; context.fillText(String(number), selection.rect.x + 12, selection.rect.y + 17)
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!), 'image/png'))
    return { png: new Uint8Array(await blob.arrayBuffer()), width: canvas.width, height: canvas.height, viewportWidth: selection.viewport.width, viewportHeight: selection.viewport.height }
  }
}
