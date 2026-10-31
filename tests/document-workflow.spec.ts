import { afterEach, expect, it, vi } from 'vitest'
import { PageBatches } from '../src/client/files/pages/batches.ts'
import { DocumentWorkflow } from '../src/client/files/document-workflow.ts'
import type { DocumentAnnotationSnapshot } from '../src/client/files/references.ts'
import type { PageSnapshot } from '../src/client/files/pages/snapshot.ts'
import { spreadsheetSnapshot } from '../src/client/files/sheets/snapshot.ts'

afterEach(() => localStorage.clear())
const page = (extension = 'pdf'): PageSnapshot => ({ version: 2, id: 'snapshot',
  address: `dsh-resource://file/absolute/D:/example.${extension}`, kind: extension === 'pdf' ? 'pdf' : 'office',
  startPage: 1, endPage: 1, text: 'Original text', comment: 'Explain' })
function fixture() {
  let target = 'here'
  const sendPages = vi.fn(async (_request: { items: readonly DocumentAnnotationSnapshot[] }) => {})
  const batches = new PageBatches()
  const workflow = new DocumentWorkflow({ targetKey: () => target, subscribe: () => () => {}, sendPages }, batches)
  return { batches, workflow, sendPages, signal: new AbortController().signal,
    scope: (item: DocumentAnnotationSnapshot) => ({ session: 'here', address: item.address }),
    switch: () => { target = 'elsewhere' } }
}

it.each(['pdf', 'docx', 'pptx'])('%s saves to a durable source batch and never sends until requested', async extension => {
  const f = fixture(), item = page(extension), scope = f.scope(item)
  localStorage.setItem('ordinary-composer-draft', 'Keep the user draft')
  await f.workflow.commit(scope, { kind: 'batch', snapshot: item }, f.signal)
  expect(new PageBatches().read('here', item.address)).toEqual([item])
  expect(f.sendPages).not.toHaveBeenCalled()
  await f.batches.save('elsewhere', item)
  await f.workflow.send(scope, f.signal)
  expect(f.sendPages).toHaveBeenCalledExactlyOnceWith({ items: [item], images: [], expectedTarget: 'here', signal: f.signal })
  expect(f.batches.read('here', item.address)).toEqual([])
  expect(f.batches.read('elsewhere', item.address)).toEqual([item])
  expect(localStorage.getItem('ordinary-composer-draft')).toBe('Keep the user draft')
})

it('the presentation shortcut sends directly while preserving an independent saved batch', async () => {
  const f = fixture(), item = page('pptx'), scope = f.scope(item)
  await f.batches.save('here', item)
  const quick = { ...item, id: 'quick', comment: 'Shorten this title' }
  await f.workflow.commit(scope, { kind: 'presentation-request', snapshot: quick }, f.signal)
  expect(f.sendPages).toHaveBeenCalledExactlyOnceWith({ items: [quick], images: [], expectedTarget: 'here', signal: f.signal })
  expect(f.batches.read('here', item.address)).toEqual([item])
  await expect(f.workflow.commit(f.scope(page('docx')), { kind: 'presentation-request', snapshot: page('docx') }, f.signal)).rejects.toThrow('快捷请求')
})

it('failed admission retains the exact batch; retry removes only the accepted unchanged payload', async () => {
  const f = fixture(), item = page(), scope = f.scope(item)
  await f.workflow.commit(scope, { kind: 'batch', snapshot: item }, f.signal)
  f.sendPages.mockRejectedValueOnce(new Error('Offline'))
  await expect(f.workflow.send(scope, f.signal)).rejects.toThrow('Offline')
  expect(new PageBatches().read('here', item.address)).toEqual([item])
  await f.workflow.send(scope, f.signal)
  expect(f.batches.read('here', item.address)).toEqual([])
})

it('an edit made by another view during admission stays unsent after the captured batch succeeds', async () => {
  const f = fixture(), item = page(), scope = f.scope(item)
  await f.batches.save('here', item)
  const edited = { ...item, comment: 'A newer unsent edit' }
  f.sendPages.mockImplementationOnce(async () => { await f.batches.save('here', edited) })
  await f.workflow.send(scope, f.signal)
  expect(f.sendPages.mock.calls[0]![0].items).toEqual([item])
  expect(new PageBatches().read('here', item.address)).toEqual([edited])
})

it('missing capability is known at construction and cannot fall back to Composer', async () => {
  const f = fixture(), item = page()
  const workflow = new DocumentWorkflow({ targetKey: () => 'here', subscribe: () => () => {} }, f.batches)
  expect(workflow.canSend).toBe(false)
  await expect(workflow.send(f.scope(item), f.signal)).rejects.toThrow('不支持')
  await workflow.commit(f.scope(item), { kind: 'batch', snapshot: item }, f.signal)
  expect(f.batches.read('here', item.address)).toEqual([item])
})

it('a changed session or mismatched file rejects the operation before any save or send', async () => {
  const f = fixture(), item = page(), scope = f.scope(item)
  await expect(f.workflow.commit({ ...scope, address: page('docx').address }, { kind: 'batch', snapshot: item }, f.signal)).rejects.toThrow('文件已切换')
  f.switch()
  await expect(f.workflow.commit(scope, { kind: 'batch', snapshot: item }, f.signal)).rejects.toThrow('会话已切换')
  expect(f.batches.read('here', item.address)).toEqual([])
  expect(f.sendPages).not.toHaveBeenCalled()
})

it.each(['xlsx', 'csv'] as const)('%s saves, reloads, edits, deletes and sends immutable cells through the same document owner', async format => {
  const f = fixture()
  const original = { ...spreadsheetSnapshot(`dsh-resource://file/absolute/D:/original.${format}`, format,
    { id: 'sheet', name: 'Source' }, { row: [0, 0], column: [0, 0] }, [[{ v: '00123', m: '00123' }]]), comment: 'Review' }
  const scope = f.scope(original)
  await f.workflow.commit(scope, { kind: 'batch', snapshot: original }, f.signal)
  const restored = new PageBatches().read('here', original.address)[0]!
  expect(restored).toEqual(original)
  const edited = { ...original, comment: 'A saved revision' }
  await f.workflow.commit(scope, { kind: 'batch', snapshot: edited }, f.signal)
  await f.workflow.remove(scope, [original.id], f.signal)
  expect(new PageBatches().read('here', original.address)).toEqual([])
  await f.workflow.commit(scope, { kind: 'batch', snapshot: edited }, f.signal)
  await f.workflow.send(scope, f.signal)
  expect(f.sendPages.mock.calls[0]![0].items).toEqual([edited])
  expect(f.batches.read('here', original.address)).toEqual([])
})
