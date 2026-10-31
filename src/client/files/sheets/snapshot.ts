import { AnnotationError } from '../../errors.ts'
import type { Cell, Selection, Sheet } from '@fortune-sheet/core'

export type CellValue = string | number | boolean | null
export type SheetRange = { row: [number, number]; column: [number, number] }
export type SheetCell = {
  row: number
  column: number
  raw: CellValue
  display: string
  formula?: string
  cached?: CellValue
  format?: string
}
export type SheetMerge = { row: number; column: number; rows: number; columns: number }
export interface SpreadsheetSnapshot {
  readonly version: 3
  readonly id: string
  readonly address: string
  readonly kind: 'xlsx' | 'csv'
  readonly sheet: { id: string; name: string }
  readonly range: SheetRange
  readonly a1: string
  readonly cells: readonly SheetCell[]
  readonly merges: readonly SheetMerge[]
  readonly text: string
  readonly comment?: string
}

const bytes = (text: string) => new TextEncoder().encode(text).length
const index = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0 && Number(v) < 1_048_576
const scalar = (v: unknown): v is CellValue => v === null || typeof v === 'string' || typeof v === 'boolean' || typeof v === 'number' && Number.isFinite(v)
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
export function columnName(column: number): string {
  let label = ''
  for (let n = column + 1; n > 0; n = Math.floor((n - 1) / 26)) label = String.fromCharCode(65 + (n - 1) % 26) + label
  return label
}
export function rangeName(range: SheetRange): string {
  const start = `${columnName(range.column[0])}${range.row[0] + 1}`
  const end = `${columnName(range.column[1])}${range.row[1] + 1}`
  return start === end ? start : `${start}:${end}`
}
export function readRange(value: unknown): SheetRange | undefined {
  if (!object(value)) return
  const pair = (v: unknown): v is [number, number] => Array.isArray(v) && v.length === 2 && v.every(index) && v[0] <= v[1]
  if (!pair(value.row) || !pair(value.column) || value.column[1] >= 16_384) return
  return { row: [...value.row], column: [...value.column] }
}

/** Freeze public Workbook API data as soon as the comment opens, never on Save. */
export function spreadsheetSnapshot(address: string, kind: 'xlsx' | 'csv', sheet: Sheet, selection: Selection,
  values: (Cell | null)[][]): SpreadsheetSnapshot {
  const range = readRange(selection)
  if (!range) throw new AnnotationError('error.contiguousSelection')
  const area = (range.row[1] - range.row[0] + 1) * (range.column[1] - range.column[0] + 1)
  if (area > 4096) throw new AnnotationError('error.selectionTooLarge')
  const cells: SheetCell[] = []
  for (let row = range.row[0]; row <= range.row[1]; row++) for (let column = range.column[0]; column <= range.column[1]; column++) {
    const cell = values[row - range.row[0]]?.[column - range.column[0]]
    const raw = scalar(cell?.v) ? cell.v : null
    cells.push({ row, column, raw, display: String(cell?.m ?? (raw === null ? '' : raw)),
      ...(cell?.f ? { formula: cell.f, ...(cell.v !== undefined ? { cached: raw } : {}) } : {}),
      ...(cell?.ct?.fa ? { format: cell.ct.fa } : {}),
    })
  }
  const merges = Object.values(sheet.config?.merge ?? {}).filter(m => m.r <= range.row[1] && m.r + m.rs > range.row[0]
    && m.c <= range.column[1] && m.c + m.cs > range.column[0]).map(m => ({ row: m.r, column: m.c, rows: m.rs, columns: m.cs }))
  const text = cells.map(cell => `${columnName(cell.column)}${cell.row + 1}: ${JSON.stringify(cell.display)}${cell.formula ? ` [${cell.formula}]` : ''}`).join('\n')
  if (bytes(JSON.stringify({ cells, merges, text })) > 64 * 1024) throw new AnnotationError('error.selectionTooLarge')
  return { version: 3, id: crypto.randomUUID(), address, kind, sheet: { id: String(sheet.id), name: sheet.name },
    range, a1: rangeName(range), cells, merges, text }
}

/** Parse only the bounded, versioned public schema; ignore unrelated persisted properties. */
export function readSpreadsheetSnapshot(value: Record<string, unknown>): SpreadsheetSnapshot | undefined {
  const range = readRange(value.range)
  if (value.version !== 3 || (value.kind !== 'xlsx' && value.kind !== 'csv') || !range || value.a1 !== rangeName(range)
    || !object(value.sheet) || typeof value.sheet.id !== 'string' || !value.sheet.id || value.sheet.id.length > 256
    || typeof value.sheet.name !== 'string' || !value.sheet.name || value.sheet.name.length > 256
    || !Array.isArray(value.cells) || !Array.isArray(value.merges)
    || (value.comment !== undefined && (typeof value.comment !== 'string' || !value.comment.trim() || value.comment.length > 8192))) return
  const area = (range.row[1] - range.row[0] + 1) * (range.column[1] - range.column[0] + 1)
  if (area > 4096 || value.cells.length !== area || value.merges.length > area) return
  const cells: SheetCell[] = []
  for (const [i, cell] of value.cells.entries()) {
    if (!object(cell) || cell.row !== range.row[0] + Math.floor(i / (range.column[1] - range.column[0] + 1))
      || cell.column !== range.column[0] + i % (range.column[1] - range.column[0] + 1) || !scalar(cell.raw)
      || typeof cell.display !== 'string' || (cell.formula !== undefined && typeof cell.formula !== 'string')
      || (cell.cached !== undefined && (!cell.formula || !scalar(cell.cached))) || (cell.format !== undefined && typeof cell.format !== 'string')) return
    cells.push({ row: Number(cell.row), column: Number(cell.column), raw: cell.raw, display: cell.display,
      ...(typeof cell.formula === 'string' ? { formula: cell.formula } : {}), ...(cell.cached !== undefined ? { cached: cell.cached as CellValue } : {}),
      ...(typeof cell.format === 'string' ? { format: cell.format } : {}) })
  }
  const merges: SheetMerge[] = []
  for (const m of value.merges) {
    if (!object(m) || !index(m.row) || !index(m.column) || !index(m.rows) || !m.rows || !index(m.columns) || !m.columns
      || m.row > range.row[1] || m.row + m.rows <= range.row[0] || m.column > range.column[1] || m.column + m.columns <= range.column[0]) return
    merges.push({ row: m.row, column: m.column, rows: m.rows, columns: m.columns })
  }
  if (bytes(JSON.stringify({ cells, merges, text: value.text })) > 64 * 1024) return
  return { version: 3, id: String(value.id), address: String(value.address), kind: value.kind,
    sheet: { id: value.sheet.id, name: value.sheet.name }, range, a1: String(value.a1), cells, merges, text: String(value.text),
    ...(typeof value.comment === 'string' ? { comment: value.comment } : {}) }
}
