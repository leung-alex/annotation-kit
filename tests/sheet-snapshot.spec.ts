import { expect, it } from 'vitest'
import { spreadsheetSnapshot } from '../src/client/files/sheets/snapshot.ts'
import { decodeFileReference, fileReference, serializeFileReference, readSentFile } from '../src/client/files/references.ts'
import { PageBatches } from '../src/client/files/pages/batches.ts'

const address = 'dsh-resource://file/absolute/D:/book.xlsx'
const signal = new AbortController().signal
const sheet = { id: 'one', name: '数据', config: { merge: { '0_0': { r: 0, c: 0, rs: 1, cs: 2 } } } }
it('freezes blank cells, typed values, formulas, cached results, formats and intersecting merges', () => {
  const values = [[{ v: 57, m: '57.00', f: '=SUM(A1,15)', ct: { fa: '0.00', t: 'n' } }, null]]
  const item = spreadsheetSnapshot(address, 'xlsx', sheet, { row: [0, 0], column: [0, 1] }, values)
  values[0]![0]!.v = 99
  expect(item.cells).toEqual([{ row: 0, column: 0, raw: 57, display: '57.00', formula: '=SUM(A1,15)', cached: 57, format: '0.00' },
    { row: 0, column: 1, raw: null, display: '' }])
  expect(item.a1).toBe('A1:B1')
  expect(item.merges).toEqual([{ row: 0, column: 0, rows: 1, columns: 2 }])
  const ref = fileReference({ ...item, comment: 'Explain' })
  expect(decodeFileReference(ref.ref)).toEqual({ ...item, comment: 'Explain' })
  const block = { type: 'text', ...serializeFileReference(ref.ref, signal) }
  expect(readSentFile(block)).toEqual({ ...item, comment: 'Explain' })
  expect(block.text).toContain('"cached":57')
  expect(ref.label).toContain("'数据'!A1:B1")
})
it('does not invent a cached result when a formula has none', () => {
  const item = spreadsheetSnapshot(address, 'xlsx', sheet, { row: [9, 9], column: [3, 3] }, [[{ f: '=NOW()', m: '' }]])
  expect(item.cells[0]).toEqual({ row: 9, column: 3, raw: null, display: '', formula: '=NOW()' })
})
it('enforces content limits and rejects inconsistent restored coordinates', () => {
  const item = spreadsheetSnapshot(address, 'csv', sheet, { row: [0, 0], column: [0, 0] }, [[{ v: '00123', m: '00123' }]])
  expect(decodeFileReference(JSON.stringify({ ...item, a1: 'B1' }))).toBeUndefined()
  expect(decodeFileReference(JSON.stringify({ ...item, cells: [{ ...item.cells[0], row: 2 }] }))).toBeUndefined()
  expect(() => spreadsheetSnapshot(address, 'csv', sheet, { row: [0, 0], column: [0, 0] }, [[{ v: '字'.repeat(24000) }]])).toThrow('64 KiB')
})
it('keeps spreadsheet batches independent across sessions and restores immutable comments after recreation', async () => {
  const store = { put: async () => {}, get: async () => undefined, remove: async () => {} }
  const item = { ...spreadsheetSnapshot(address, 'xlsx', sheet, { row: [2, 2], column: [2, 2] }, [[null]]), comment: 'Empty cell' }
  const before = new PageBatches(store)
  await before.save('sheet-test', item)
  const after = new PageBatches(store)
  expect(after.read('sheet-test', address)).toEqual([item])
  expect(after.read('other-session', address)).toEqual([])
  await after.save('sheet-test', { ...item, comment: 'Edited' })
  expect(after.read('sheet-test', address)[0]).toEqual({ ...item, comment: 'Edited' })
  await after.remove('sheet-test', address, [item.id])
})
