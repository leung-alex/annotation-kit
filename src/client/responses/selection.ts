import type { ResponseTextAnchor, ResponseAnnotationSnapshot } from './references.ts'

export interface ResponseSource {
  readonly sessionId: string
  readonly nodeKey: string
  readonly nodeId: string
  readonly turn: number
  readonly step: number
  readonly seq: number
  readonly blockIndex: number
  readonly text: string
}
export interface ResponseSurface { readonly root: HTMLElement; readonly source: ResponseSource; readonly reveal: () => void }
interface TextSegment { readonly node: Text; readonly start: number; readonly end: number }
export interface TextProjection { readonly text: string; readonly segments: readonly TextSegment[] }
const excluded = 'button,input,textarea,select,svg,script,style,[role="button"],[aria-hidden="true"],[hidden],[inert],[data-code-block-banner],[data-response-annotation-ui]'
const blocks = /^(P|DIV|LI|UL|OL|BLOCKQUOTE|PRE|H[1-6]|TR|TABLE|SECTION)$/u

/** A deterministic visible-text coordinate plane; formatting separators are explicit. */
export function projectResponseText(root: HTMLElement): TextProjection {
  let text = ''
  const segments: TextSegment[] = []
  const separator = (value: string) => { if (text && !text.endsWith(value)) text += value }
  const visit = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      const value = node.textContent ?? ''
      if (value) { segments.push({ node: node as Text, start: text.length, end: text.length + value.length }); text += value }
      return
    }
    if (!(node instanceof HTMLElement) || node.matches(excluded)) return
    const style = getComputedStyle(node)
    if (style.display === 'none' || style.visibility === 'hidden') return
    if (node.tagName === 'BR') { text += '\n'; return }
    if (blocks.test(node.tagName)) separator('\n')
    if (node.tagName === 'TD' || node.tagName === 'TH') separator('\t')
    node.childNodes.forEach(visit)
    if (blocks.test(node.tagName)) separator('\n')
  }
  root.childNodes.forEach(visit)
  // Remove only synthetic trailing separators; literal code whitespace remains intact.
  return { text: text.slice(0, segments.at(-1)?.end ?? 0), segments }
}

export function prefixHash(text: string): string {
  let hash = 2166136261
  for (let index = 0; index < text.length; index++) hash = Math.imul(hash ^ text.charCodeAt(index), 16777619)
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function sliceRange(range: Range, segment: TextSegment): { start: number; end: number } | undefined {
  const nodeRange = document.createRange()
  nodeRange.selectNodeContents(segment.node)
  if (range.compareBoundaryPoints(Range.END_TO_START, nodeRange) >= 0 || range.compareBoundaryPoints(Range.START_TO_END, nodeRange) <= 0) return undefined
  const start = range.startContainer === segment.node ? range.startOffset : 0
  const end = range.endContainer === segment.node ? range.endOffset : segment.node.length
  return end > start ? { start: segment.start + start, end: segment.start + end } : undefined
}

export interface ResponseSelection {
  readonly snapshot: ResponseAnnotationSnapshot
  readonly ranges: readonly Range[]
  readonly sources: readonly { readonly surface: ResponseSurface; readonly text: string }[]
}

/** Both boundaries must belong to registered text blocks of the same assistant node. */
export function readResponseSelection(range: Range, surfaces: readonly ResponseSurface[], sessionId: string): ResponseSelection | undefined {
  if (range.collapsed) return undefined
  const first = surfaces.find(surface => surface.root.contains(range.startContainer))
  const last = surfaces.find(surface => surface.root.contains(range.endContainer))
  if (!first || !last || first.source.sessionId !== sessionId || last.source.sessionId !== sessionId
    || first.source.nodeKey !== last.source.nodeKey) return undefined
  const selected = surfaces.filter(surface => surface.source.sessionId === sessionId && surface.source.nodeKey === first.source.nodeKey
    && range.intersectsNode(surface.root)).sort((a, b) => a.source.blockIndex - b.source.blockIndex)
  const anchors: ResponseTextAnchor[] = []
  const ranges: Range[] = []
  for (const surface of selected) {
    const projection = projectResponseText(surface.root)
    const portions = projection.segments.flatMap(segment => { const portion = sliceRange(range, segment); return portion ? [portion] : [] })
    if (!portions.length) continue
    const start = portions[0]!.start
    const end = portions.at(-1)!.end
    const anchor: ResponseTextAnchor = { blockIndex: surface.source.blockIndex, start, end,
      text: projection.text.slice(start, end), prefixHash: prefixHash(projection.text.slice(0, end)) }
    anchors.push(anchor)
    ranges.push(...rangesForAnchor(projection, anchor))
  }
  const text = anchors.map(anchor => anchor.text).join('\n\n')
  if (!text.trim()) return undefined
  const { blockIndex: _block, text: _source, ...source } = first.source
  return { snapshot: { version: 1, id: crypto.randomUUID(), ...source, text, comment: '', anchors }, ranges,
    sources: selected.map(surface => ({ surface, text: surface.source.text })) }
}

/** Reuse saved positions only while the original prefix and selection still agree. */
export function rangesForAnchor(projection: TextProjection, anchor: ResponseTextAnchor): Range[] {
  if (projection.text.slice(anchor.start, anchor.end) !== anchor.text || prefixHash(projection.text.slice(0, anchor.end)) !== anchor.prefixHash) return []
  return projection.segments.flatMap(segment => {
    const start = Math.max(anchor.start, segment.start)
    const end = Math.min(anchor.end, segment.end)
    if (end <= start) return []
    const range = document.createRange()
    range.setStart(segment.node, start - segment.start)
    range.setEnd(segment.node, end - segment.start)
    return [range]
  })
}

export function selectionCurrent(selection: ResponseSelection): boolean {
  return selection.sources.every(({ surface, text }) => surface.root.isConnected && surface.source.text === text)
    && selection.snapshot.anchors.every(anchor => {
      const surface = selection.sources.find(item => item.surface.source.blockIndex === anchor.blockIndex)?.surface
      return !!surface && rangesForAnchor(projectResponseText(surface.root), anchor).length > 0
    })
}
