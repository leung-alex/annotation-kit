import { AnnotationError } from '../../errors.ts'
import type { PageRect } from './snapshot.ts'

/** Read only PDF text-layer nodes; canvas labels and toolbar text are not evidence. */
export function readPageText(range: Range, preview: HTMLElement) {
  if (range.collapsed || !preview.contains(range.startContainer) || !preview.contains(range.endContainer)) return undefined
  const element = (node: Node) => node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement
  if (!element(range.startContainer)?.closest('[data-pdf-text]') || !element(range.endContainer)?.closest('[data-pdf-text]')) return undefined
  const pages: { page: number; text: string }[] = []
  for (const layer of preview.querySelectorAll<HTMLElement>('[data-pdf-page] [data-pdf-text]')) {
    if (!range.intersectsNode(layer)) continue
    const part = layer.ownerDocument.createRange()
    part.selectNodeContents(layer)
    if (layer.contains(range.startContainer)) part.setStart(range.startContainer, range.startOffset)
    if (layer.contains(range.endContainer)) part.setEnd(range.endContainer, range.endOffset)
    const text = part.toString()
    const page = Number(layer.closest<HTMLElement>('[data-pdf-page]')?.dataset.pdfPage)
    if (text.trim() && Number.isSafeInteger(page) && page > 0) pages.push({ page, text })
  }
  if (!pages.length) return undefined
  return { startPage: pages[0]!.page, endPage: pages.at(-1)!.page,
    text: pages.length === 1 ? pages[0]!.text : pages.map(p => `[Page ${p.page}]\n${p.text}`).join('\n\n') }
}

export function pageRegion(start: { x: number; y: number }, end: { x: number; y: number }, bounds: DOMRect): PageRect | undefined {
  if (bounds.width <= 0 || bounds.height <= 0) return undefined
  const x = (v: number) => Math.max(0, Math.min(1, (v - bounds.left) / bounds.width))
  const y = (v: number) => Math.max(0, Math.min(1, (v - bounds.top) / bounds.height))
  const left = Math.min(x(start.x), x(end.x)), top = Math.min(y(start.y), y(end.y))
  const width = Math.abs(x(start.x) - x(end.x)), height = Math.abs(y(start.y) - y(end.y))
  if (width * bounds.width < 4 || height * bounds.height < 4) return undefined
  return { x: left, y: top, width, height }
}

/** Crop the page's existing backing pixels, excluding selection chrome and the app UI. */
export async function capturePageRegion(canvas: HTMLCanvasElement, rect: PageRect, key: string, signal: AbortSignal) {
  signal.throwIfAborted()
  if (!canvas.isConnected || canvas.width <= 0 || canvas.height <= 0) throw new AnnotationError('error.pageNotReady')
  const x = Math.floor(rect.x * canvas.width), y = Math.floor(rect.y * canvas.height)
  const width = Math.min(canvas.width - x, Math.ceil(rect.width * canvas.width))
  const height = Math.min(canvas.height - y, Math.ceil(rect.height * canvas.height))
  const scale = Math.min(1, 4096 / Math.max(width, height))
  const crop = canvas.ownerDocument.createElement('canvas')
  crop.width = Math.max(1, Math.round(width * scale)); crop.height = Math.max(1, Math.round(height * scale))
  const context = crop.getContext('2d')
  if (!context) throw new AnnotationError('error.captureRegion')
  context.drawImage(canvas, x, y, width, height, 0, 0, crop.width, crop.height)
  const blob = await new Promise<Blob>((resolve, reject) => crop.toBlob(value => value ? resolve(value) : reject(new AnnotationError('error.encodeRegion')), 'image/png'))
  signal.throwIfAborted()
  if (blob.size > 8 * 1024 * 1024) throw new AnnotationError('error.regionTooLarge')
  const name = `aione-page-${key}.png`
  return { image: { key, name, width: crop.width, height: crop.height }, file: new File([blob], name, { type: 'image/png' }) }
}
