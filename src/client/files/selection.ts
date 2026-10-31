export type FileKind = 'code' | 'text' | 'markdown'

export interface FileSelection {
  readonly text: string
  readonly startLine: number
  readonly endLine: number
  readonly startColumn?: number
  readonly endColumn?: number
}

/** A selection is accepted only when both ends belong to the same preview body. */
export function readFileSelection(range: Range, root: HTMLElement, kind: FileKind): FileSelection | undefined {
  if (range.collapsed || !root.contains(range.startContainer) || !root.contains(range.endContainer)) return undefined
  const text = range.toString()
  if (text.trim() === '') return undefined
  if (kind === 'code') {
    const code = root.querySelector<HTMLElement>('pre code')
    if (code === null || !code.contains(range.startContainer) || !code.contains(range.endContainer)) return undefined
    const prefix = range.cloneRange()
    prefix.selectNodeContents(code)
    prefix.setEnd(range.startContainer, range.startOffset)
    const start = lineColumn(prefix.toString())
    const selected = lineColumn(text)
    const endLine = start.line + selected.line - 1
    const endColumn = selected.line === 1 ? start.column + selected.column - 1 : selected.column
    return { text, startLine: start.line, endLine, startColumn: start.column, endColumn }
  }
  const selector = kind === 'text' ? '[data-textpreview-line]' : '[data-annotation-source-start-line]'
  const nodes = Array.from(root.querySelectorAll<HTMLElement>(selector))
  const touched = nodes.filter(node => {
    if (!range.intersectsNode(node)) return false
    const intersection = range.cloneRange()
    const nodeRange = range.cloneRange()
    nodeRange.selectNodeContents(node)
    if (intersection.compareBoundaryPoints(Range.START_TO_START, nodeRange) < 0) {
      intersection.setStart(nodeRange.startContainer, nodeRange.startOffset)
    }
    if (intersection.compareBoundaryPoints(Range.END_TO_END, nodeRange) > 0) {
      intersection.setEnd(nodeRange.endContainer, nodeRange.endOffset)
    }
    return !intersection.collapsed && intersection.toString().length > 0
  })
  if (touched.length === 0) return undefined
  if (kind === 'text') {
    const first = Number(touched[0]?.getAttribute('data-textpreview-line'))
    const last = Number(touched.at(-1)?.getAttribute('data-textpreview-line'))
    if (!Number.isInteger(first) || !Number.isInteger(last)) return undefined
    return { text, startLine: first, endLine: last }
  }
  const first = Number(touched[0]?.getAttribute('data-annotation-source-start-line'))
  const last = Number(touched.at(-1)?.getAttribute('data-annotation-source-end-line'))
  if (!Number.isInteger(first) || !Number.isInteger(last)) return undefined
  return { text, startLine: first, endLine: last }
}

function lineColumn(text: string): { line: number; column: number } {
  const parts = text.split(/\r\n|\r|\n/u)
  return { line: parts.length, column: (parts.at(-1)?.length ?? 0) + 1 }
}
