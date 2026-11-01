import { forwardRef, memo, useCallback } from 'react'
import { createRoot } from 'react-dom/client'
import { Workbook, type WorkbookInstance } from '@fortune-sheet/react'
import type { Selection, Sheet } from '@fortune-sheet/core'
import type { ComponentProps } from 'react'
import '@fortune-sheet/react/dist/index.css'
import { SheetSurface } from '../../../src/client/files/sheets/SheetSurface.tsx'
import { PageBatches } from '../../../src/client/files/pages/batches.ts'
import { en } from '../../../src/client/locales.ts'
import type { PropsLocale } from '../../../src/host-contracts.ts'
import './style.css'

const address = 'memory://test/selection.csv'
const rows = [
  ['ID', 'Name', 'Count', 'Status'],
  ['RC5-001', 'First', 12, 'Ready'],
  ['RC5-002', 'Second', 24, 'Review'],
  ['RC5-003', 'Third', 36, 'Done'],
]
const sheet: Sheet = { id: 'csv', name: 'CSV', status: 1, row: 30, column: 12,
  luckysheet_select_save: [{ row: [0, 0], column: [0, 0], row_focus: 0, column_focus: 0 }],
  celldata: rows.flatMap((row, r) => row.map((v, c) => ({ r, c, v: { v, m: String(v) } }))) }
let workbook: WorkbookInstance | null = null
const StableWorkbook = memo(forwardRef<WorkbookInstance, ComponentProps<typeof Workbook>>(function TestWorkbook(props, ref) {
  const attach = useCallback((instance: WorkbookInstance | null) => {
    workbook = instance
    if (typeof ref === 'function') ref(instance)
    else if (ref) ref.current = instance
  }, [ref])
  return <Workbook {...props} ref={attach} />
}))
let session = 'sheet-regression'
const listeners = new Set<() => void>()
const bridge = { targetKey: () => session, subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
  sendPages: async () => { throw new Error('This regression only saves locally') } }
const t = ((key: keyof typeof en) => en[key]) as PropsLocale<'annotations'>['t']
const excelT: PropsLocale<string>['t'] = key => key === 'language' ? 'en' : 'Spreadsheet'

const root = createRoot(document.getElementById('root')!)
declare global {
  interface Window {
    sheetTest: { select: (ranges: Selection[]) => void; changeCell: () => void; cellValue: () => unknown; changeSession: () => void; unmount: () => void }
  }
}
window.sheetTest = {
  select: ranges => workbook!.setSelection(ranges),
  changeCell: () => workbook!.setCellValue(1, 0, 'CHANGED'),
  cellValue: () => workbook!.getCellValue(1, 0),
  changeSession: () => { session = 'another-session'; for (const listener of listeners) listener() },
  unmount: () => root.unmount(),
}
root.render(<main data-textpreview-url={address}>
  <header><h1>CSV selection regression</h1><span data-sheet-annotation-toolbar /></header>
  <SheetSurface resourceAddress={address} format="csv" value={{ sheets: [sheet], unsupportedFeatures: [] }}
    bridge={bridge} at={t} batches={new PageBatches()} t={excelT} Workbook={StableWorkbook}
    bodyCss={{ body: 'sheet-body', workbook: 'workbook' }} />
</main>)
