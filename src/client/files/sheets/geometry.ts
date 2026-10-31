import type { Hooks, Sheet } from '@fortune-sheet/core'
import type { SheetRange } from './snapshot.ts'

export interface Box { left: number; top: number; width: number; height: number; right: number; bottom: number }
export function clip(box: Box, bounds: Box): Box | undefined {
  const left = Math.max(box.left, bounds.left), top = Math.max(box.top, bounds.top)
  const right = Math.min(box.right, bounds.right), bottom = Math.min(box.bottom, bounds.bottom)
  return right > left && bottom > top ? { left, top, right, bottom, width: right - left, height: bottom - top } : undefined
}
export function union(boxes: readonly Box[]): Box | undefined {
  if (!boxes.length) return
  const left = Math.min(...boxes.map(b => b.left)), top = Math.min(...boxes.map(b => b.top))
  const right = Math.max(...boxes.map(b => b.right)), bottom = Math.max(...boxes.map(b => b.bottom))
  return { left, top, right, bottom, width: right - left, height: bottom - top }
}
type Paint = Parameters<NonNullable<Hooks['afterRenderCell']>>[1]

/** Public cell paint hooks already include zoom and frozen-pane offsets. No React internals. */
export class PaintedCells {
  private cells = new Map<string, { row: number; column: number; box: Box; canvas: HTMLCanvasElement }>()
  private columns = new Map<number, number>()
  private rows = new Map<number, number>()
  private columnStarts = new Map<number, number>()
  private rowStarts = new Map<number, number>()
  private headerLeft?: number
  private headerTop?: number
  clear() { this.cells.clear(); this.columns.clear(); this.rows.clear(); this.columnStarts.clear(); this.rowStarts.clear() }
  column(index: number, left: number, width: number, ctx: CanvasRenderingContext2D, headerHeight = 19) {
    const box = ctx.canvas.getBoundingClientRect(), transform = ctx.getTransform()
    this.columns.set(index, box.left + (transform.a * (left + width) + transform.e) * box.width / ctx.canvas.width)
    this.columnStarts.set(index, box.left + (transform.a * left + transform.e) * box.width / ctx.canvas.width)
    this.headerTop = box.top + (transform.d * (headerHeight + 1) + transform.f) * box.height / ctx.canvas.height
  }
  row(index: number, top: number, height: number, ctx: CanvasRenderingContext2D, headerWidth = 45) {
    const box = ctx.canvas.getBoundingClientRect(), transform = ctx.getTransform()
    this.rows.set(index, box.top + (transform.d * (top + height) + transform.f) * box.height / ctx.canvas.height)
    this.rowStarts.set(index, box.top + (transform.d * top + transform.f) * box.height / ctx.canvas.height)
    this.headerLeft = box.left + (transform.a * (headerWidth + 1) + transform.e) * box.width / ctx.canvas.width
  }
  record(info: Paint, ctx: CanvasRenderingContext2D) {
    const canvas = ctx.canvas, transform = ctx.getTransform(), bounds = canvas.getBoundingClientRect()
    const sx = bounds.width / canvas.width, sy = bounds.height / canvas.height
    const left = bounds.left + (transform.a * info.startX + transform.e) * sx
    const top = bounds.top + (transform.d * info.startY + transform.f) * sy
    const right = bounds.left + (transform.a * info.endX + transform.e) * sx
    const bottom = bounds.top + (transform.d * info.endY + transform.f) * sy
    this.cells.set(`${info.row}:${info.column}`, { row: info.row, column: info.column, canvas,
      box: { left, top, right, bottom, width: right - left, height: bottom - top } })
  }
  range(range: SheetRange, bounds: Box, frozen?: Sheet['frozen']): Box | undefined {
    const boxes: Box[] = []
    const frozenRow = frozen && ['row', 'both', 'rangeRow', 'rangeBoth'].includes(frozen.type) ? frozen.range?.row_focus ?? 0 : -1
    const frozenColumn = frozen && ['column', 'both', 'rangeColumn', 'rangeBoth'].includes(frozen.type) ? frozen.range?.column_focus ?? 0 : -1
    let freezeBottom = -Infinity, freezeRight = -Infinity
    for (const [row, bottom] of this.rows) if (row <= frozenRow) freezeBottom = Math.max(freezeBottom, bottom)
    for (const [column, right] of this.columns) if (column <= frozenColumn) freezeRight = Math.max(freezeRight, right)
    if (this.columns.size && this.rows.size) {
      // A merged cell can be painted wider than its frozen canvas clip. Header
      // intervals describe the visible logical columns/rows in both panes.
      const visible = (ends: Map<number, number>, starts: Map<number, number>, selected: [number, number], frozenIndex: number, boundary: number, minimum: number, maximum: number) => {
        const spans: [number, number][] = []
        for (const [index, end] of ends) {
          if (index < selected[0] || index > selected[1]) continue
          const start = Math.max(starts.get(index)!, minimum, index > frozenIndex ? boundary : -Infinity)
          const stop = Math.min(end, maximum, index <= frozenIndex ? boundary : Infinity)
          if (stop > start) spans.push([start, stop])
        }
        return spans.length ? [Math.min(...spans.map(s => s[0])), Math.max(...spans.map(s => s[1]))] : undefined
      }
      const x = visible(this.columns, this.columnStarts, range.column, frozenColumn, freezeRight, Math.max(bounds.left, this.headerLeft ?? bounds.left), bounds.right)
      const y = visible(this.rows, this.rowStarts, range.row, frozenRow, freezeBottom, Math.max(bounds.top, this.headerTop ?? bounds.top), bounds.bottom)
      return x && y ? { left: x[0]!, right: x[1]!, top: y[0]!, bottom: y[1]!, width: x[1]! - x[0]!, height: y[1]! - y[0]! } : undefined
    }
    for (const cell of this.cells.values()) {
      if (cell.row < range.row[0] || cell.row > range.row[1] || cell.column < range.column[0] || cell.column > range.column[1]) continue
      const canvas = cell.canvas.getBoundingClientRect()
      // Header hooks carry the current zoom; the cell pass excludes hidden rows/columns.
      const viewport = clip({ ...canvas, left: this.headerLeft ?? canvas.left + 46, top: this.headerTop ?? canvas.top + 20, right: canvas.right, bottom: canvas.bottom,
        width: canvas.width - 46, height: canvas.height - 20 }, bounds)
      const pane = viewport && { ...viewport,
        left: cell.column > frozenColumn ? Math.max(viewport.left, freezeRight) : viewport.left,
        top: cell.row > frozenRow ? Math.max(viewport.top, freezeBottom) : viewport.top }
      const box = pane && clip(cell.box, pane)
      if (box) boxes.push(box)
    }
    return union(boxes)
  }
}
