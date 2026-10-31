import type { PageRect, PageSnapshot } from './snapshot.ts'
export type Box = { left: number; top: number; width: number; height: number; right: number; bottom: number }
export type Anchor = NonNullable<PageSnapshot['anchors']>[number]
export function normalizeRect(rect: Box, page: Box): PageRect | undefined {
  if (page.width <= 0 || page.height <= 0) return undefined
  const x = Math.max(0, (rect.left - page.left) / page.width), y = Math.max(0, (rect.top - page.top) / page.height)
  const width = Math.min(1, (rect.right - page.left) / page.width) - x, height = Math.min(1, (rect.bottom - page.top) / page.height) - y
  return width > 0 && height > 0 ? { x, y, width, height } : undefined
}
export function pageBounds(preview: HTMLElement, page: number) {
  const node = preview.querySelector<HTMLElement>(`[data-pdf-page="${page}"]`)
  return (node?.querySelector('canvas') ?? node)?.getBoundingClientRect()
}
export function rangeAnchors(range: Range, preview: HTMLElement): Anchor[] {
  const anchors: Anchor[] = []
  for (const page of preview.querySelectorAll<HTMLElement>('[data-pdf-page]')) {
    const layer = page.querySelector('[data-pdf-text]')
    if (!layer || !range.intersectsNode(layer)) continue
    const part = document.createRange()
    part.selectNodeContents(layer)
    if (layer.contains(range.startContainer)) part.setStart(range.startContainer, range.startOffset)
    if (layer.contains(range.endContainer)) part.setEnd(range.endContainer, range.endOffset)
    const bounds = (page.querySelector('canvas') ?? page).getBoundingClientRect()
    for (const box of Array.from(part.getClientRects())) {
      const rect = normalizeRect(box, bounds)
      if (rect && box.width > 1 && box.height > 1) anchors.push({ page: Number(page.dataset.pdfPage), rect })
    }
  }
  return anchors.slice(0, 512)
}
export function projectAnchors(anchors: readonly Anchor[], preview: HTMLElement): Box[] {
  return anchors.flatMap(anchor => {
    const page = pageBounds(preview, anchor.page)
    if (!page || !page.width || !page.height) return []
    const { rect } = anchor, left = page.left + rect.x * page.width, top = page.top + rect.y * page.height
    const width = rect.width * page.width, height = rect.height * page.height
    return [{ left, top, width, height, right: left + width, bottom: top + height }]
  })
}
export function enclosing(boxes: readonly Box[]): Box | undefined {
  if (!boxes.length) return undefined
  const left = Math.min(...boxes.map(b => b.left)), right = Math.max(...boxes.map(b => b.right))
  const top = Math.min(...boxes.map(b => b.top)), bottom = Math.max(...boxes.map(b => b.bottom))
  return { left, right, top, bottom, width: right - left, height: bottom - top }
}
