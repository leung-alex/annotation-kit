import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { PropsLocale } from '../src/host-contracts.ts'
import type { ComposerBridge } from '../src/host-contracts.ts'
import { sheetRecoveryComponent, failedSheetPreview } from '../src/client/files/sheets/SheetRecovery.tsx'
import { spreadsheetSnapshot } from '../src/client/files/sheets/snapshot.ts'
import { PageBatches } from '../src/client/files/pages/batches.ts'
import { en, zh } from '../src/client/locales.ts'
import { AnnotationError } from '../src/client/errors.ts'

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
})
afterEach(() => { cleanup(); document.querySelectorAll('[data-textpreview-url]').forEach(node => node.remove()); vi.unstubAllGlobals() })
const t = ((key: keyof typeof en) => en[key]) as PropsLocale<'annotations'>['t']
it.each(['xlsx', 'csv'] as const)('%s reviews immutable cells after source failure, retains failed sends and sends only that session/file batch', async format => {
  const address = `dsh-resource://file/absolute/D:/deleted.${format}`
  const host = document.createElement('section')
  host.dataset.textpreviewUrl = address
  host.innerHTML = '<div data-textpreview-failed="notFound"></div>'
  host.getBoundingClientRect = () => new DOMRect(500, 20, 400, 650)
  document.body.append(host)
  expect(failedSheetPreview(document)?.address).toBe(address)
  const item = { ...spreadsheetSnapshot(address, format, { id: 's', name: 'Saved sheet' }, { row: [0, 0], column: [0, 0] }, [[{ v: '00123', m: '00123' }]]), comment: 'Original comment' }
  const batches = new PageBatches()
  await batches.save('here', item); await batches.save('elsewhere', item)
  const sendPages = vi.fn<NonNullable<ComposerBridge['sendPages']>>().mockRejectedValueOnce(new AnnotationError('error.sendFailed')).mockResolvedValueOnce(undefined)
  const bridge: ComposerBridge = { targetKey: () => 'here', hasTarget: () => true, subscribe: () => () => {}, dispose() {}, add: vi.fn(), sendPages }
  const Recovery = sheetRecoveryComponent(bridge, batches)
  const view = render(<Recovery sessionId="here" t={t} />)
  expect(await screen.findByText('00123')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
  expect(await screen.findByText('Could not send the annotations. Try again.')).toBeTruthy()
  expect(batches.read('here', address)).toEqual([item])
  view.rerender(<Recovery sessionId="here" t={((key: keyof typeof zh) => zh[key]) as typeof t} />)
  expect(screen.getByText('批注发送失败，请重试')).toBeTruthy()
  expect(screen.getByText('Original comment')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '发送' }))
  await waitFor(() => expect(document.querySelector('[data-sheet-recovery]')).toBeNull())
  expect(sendPages.mock.calls[1]![0].items).toEqual([item])
  expect(batches.read('elsewhere', address)).toEqual([item])
  expect(bridge.add).not.toHaveBeenCalled()
})

it('does not introduce recovery UI for CSV source mode or an unrelated file format', () => {
  const host = document.createElement('section')
  host.dataset.textpreviewUrl = 'dsh-resource://file/absolute/D:/source.csv'
  host.innerHTML = '<pre data-code-preview>00123</pre>'
  document.body.append(host)
  expect(failedSheetPreview(document)).toBeUndefined()
  host.dataset.textpreviewUrl = 'dsh-resource://file/absolute/D:/source.tsv'
  host.innerHTML = '<div data-textpreview-failed="notFound"></div>'
  expect(failedSheetPreview(document)).toBeUndefined()
})
