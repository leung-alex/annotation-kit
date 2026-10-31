/** Page coordinates are normalized to the rendered page, independent of zoom. */
export type PageRect = { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
export interface PageSnapshot {
  readonly version: 2
  readonly id: string
  readonly address: string
  readonly kind: 'pdf' | 'office'
  readonly text: string
  readonly startPage: number
  readonly endPage: number
  readonly comment?: string
  readonly anchors?: readonly { readonly page: number; readonly rect: PageRect }[]
  readonly region?: PageRect
  readonly image?: { readonly key: string; readonly name: string; readonly width: number; readonly height: number }
}

export function isPageSnapshot(value: Record<string, unknown>): boolean {
  const page = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v > 0 && v <= 100000
  if (value.comment !== undefined && (typeof value.comment !== 'string' || !value.comment.trim() || value.comment.length > 8192)) return false
  if (value.anchors !== undefined && (!Array.isArray(value.anchors) || value.anchors.length > 512
    || value.anchors.some(anchor => !anchor || !page(anchor.page) || anchor.page < Number(value.startPage)
      || anchor.page > Number(value.endPage) || !validPageRect(anchor.rect)))) return false
  if (value.version !== 2 || !['pdf', 'office'].includes(String(value.kind))
    || !page(value.startPage) || !page(value.endPage) || value.endPage < value.startPage || value.endPage - value.startPage > 31) return false
  if (value.region === undefined && value.image === undefined) return typeof value.text === 'string' && !!value.text.trim()
  if (value.startPage !== value.endPage || typeof value.region !== 'object' || value.region === null
    || typeof value.image !== 'object' || value.image === null) return false
  const rect = value.region as Record<string, unknown>, image = value.image as Record<string, unknown>
  const unit = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1
  return unit(rect.x) && unit(rect.y) && unit(rect.width) && unit(rect.height) && rect.width > 0 && rect.height > 0
    && rect.x + rect.width <= 1.000001 && rect.y + rect.height <= 1.000001
    && typeof image.key === 'string' && /^[a-zA-Z0-9-]{1,128}$/u.test(image.key) && image.key === value.id
    && image.name === `aione-page-${image.key}.png` && page(image.width) && page(image.height)
    && image.width <= 4096 && image.height <= 4096
}

export function validPageRect(value: unknown): value is PageRect {
  if (!value || typeof value !== 'object') return false
  const r = value as Record<string, unknown>
  return [r.x, r.y, r.width, r.height].every(v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1)
    && Number(r.width) > 0 && Number(r.height) > 0 && Number(r.x) + Number(r.width) <= 1.000001
    && Number(r.y) + Number(r.height) <= 1.000001
}
