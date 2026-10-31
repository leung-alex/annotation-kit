import { expect, it } from 'vitest'
import { PaintedCells, type Box } from '../src/client/files/sheets/geometry.ts'

const bounds: Box = { left: 100, top: 100, width: 500, height: 400, right: 600, bottom: 500 }
function context(scale = 1) {
  const canvas = document.createElement('canvas')
  canvas.width = 1000; canvas.height = 800
  canvas.getBoundingClientRect = () => DOMRect.fromRect({ x: 100, y: 100, width: 500, height: 400 })
  return { canvas, getTransform: () => ({ a: 2 * scale, d: 2 * scale, e: 0, f: 0 }) } as CanvasRenderingContext2D
}
it('uses public paint transforms for zoom and device pixel ratio, clipped to the owning preview', () => {
  const paints = new PaintedCells(), ctx = context(1.5)
  paints.record({ row: 1, column: 1, startX: 100, endX: 500, startY: 40, endY: 70 } as Parameters<PaintedCells['record']>[0], ctx)
  expect(paints.range({ row: [1, 1], column: [1, 1] }, bounds)).toEqual({ left: 250, top: 160, right: 600, bottom: 205, width: 350, height: 45 })
})
it('derives frozen column boundaries from headers, not the width of a merged cell', () => {
  const paints = new PaintedCells(), ctx = context()
  paints.column(0, 46, 100, ctx); paints.row(0, 20, 20, ctx)
  paints.column(1, 146, 100, ctx); paints.row(3, 80, 20, ctx)
  paints.record({ row: 4, column: 0, startX: 46, endX: 346, startY: 100, endY: 120 } as Parameters<PaintedCells['record']>[0], ctx)
  paints.record({ row: 3, column: 1, startX: 146, endX: 246, startY: 80, endY: 100 } as Parameters<PaintedCells['record']>[0], ctx)
  expect(paints.range({ row: [3, 3], column: [1, 1] }, bounds, { type: 'both' })).toEqual({ left: 246, top: 180, right: 346, bottom: 200, width: 100, height: 20 })
  paints.clear()
  expect(paints.range({ row: [3, 3], column: [1, 1] }, bounds)).toBeUndefined()
})
it('clips a merged range at the visible scrolled columns rather than its full frozen paint width', () => {
  const paints = new PaintedCells(), ctx = context()
  paints.column(0, 46, 100, ctx); paints.column(2, 120, 100, ctx); paints.column(3, 220, 100, ctx)
  paints.row(0, 20, 20, ctx); paints.row(4, 100, 20, ctx)
  paints.record({ row: 4, column: 0, startX: 46, endX: 346, startY: 100, endY: 120 } as Parameters<PaintedCells['record']>[0], ctx)
  expect(paints.range({ row: [4, 4], column: [0, 2] }, bounds, { type: 'both' })).toEqual({ left: 146, top: 200, right: 320, bottom: 220, width: 174, height: 20 })
  expect(paints.range({ row: [4, 4], column: [1, 1] }, bounds, { type: 'both' })).toBeUndefined()
})
