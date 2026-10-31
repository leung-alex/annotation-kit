import { splitFrontmatter } from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/src/client/markdown/frontmatter.ts'
import { parseGfmWithMath } from '@deepseek-ai/dsh-client-ui-primitives/src/markdown/parse.ts'

export interface SourceBlockRange {
  readonly startLine: number
  readonly endLine: number
}

/** Position metadata belongs to parsed source blocks; return none if DOM parity cannot be proved. */
export function markdownSourceRanges(source: string, renderedBlocks: number): readonly SourceBlockRange[] | undefined {
  const split = splitFrontmatter(source)
  const body = split?.body ?? source
  const offset = source.slice(0, source.length - body.length).split(/\r\n|\r|\n/u).length - 1
  const root = parseGfmWithMath(body)
  // Raw top-level HTML renders as a text node, while the footnote section adds an
  // element. Their counts can accidentally cancel out and shift every line label.
  if (root.children.some(node => node.type === 'html')) return undefined
  const blocks = root.children.filter(node => node.type !== 'definition' && node.type !== 'footnoteDefinition')
  const footnotes = root.children.filter(node => node.type === 'footnoteDefinition' && node.position !== undefined)
  const hasFootnoteSection = renderedBlocks === blocks.length + 1 && footnotes.length > 0
  if ((!hasFootnoteSection && blocks.length !== renderedBlocks) || blocks.some(node => node.position === undefined)) return undefined
  const ranges = blocks.map(node => ({
    startLine: offset + node.position!.start.line,
    endLine: offset + node.position!.end.line,
  }))
  if (hasFootnoteSection) ranges.push({
    startLine: offset + Math.min(...footnotes.map(node => node.position!.start.line)),
    endLine: offset + Math.max(...footnotes.map(node => node.position!.end.line)),
  })
  return ranges
}
