import { beforeEach, expect, it, vi } from 'vitest'
import { PageBatches } from '../src/client/files/pages/batches.ts'
import type { PageImageStore } from '../src/client/files/pages/image-store.ts'
import type { PageSnapshot } from '../src/client/files/pages/snapshot.ts'
import { decodeFileReference, fileReference, serializeFileReference } from '../src/client/files/references.ts'

beforeEach(() => localStorage.clear())
const item: PageSnapshot = { version: 2, id: 'batch-one', address: 'dsh-resource://file/absolute/D:/file.pdf', kind: 'pdf',
  text: 'selected evidence', comment: 'Explain this', startPage: 1, endPage: 1, anchors: [{ page: 1, rect: { x: .1, y: .2, width: .3, height: .1 } }] }
function imageStore() {
  const files = new Map<string, File>()
  const store: PageImageStore = { put: async (key, file) => { files.set(key, file) }, get: async key => files.get(key), remove: async key => { files.delete(key) } }
  return { store, files }
}
it('restores per-session per-document comments without using or changing Composer drafts', async () => {
  localStorage.setItem('ordinary-composer-draft', 'keep me')
  const { store } = imageStore(), before = new PageBatches(store)
  await before.save('one', item)
  const after = new PageBatches(store)
  expect(after.read('one', item.address)).toEqual([item])
  expect(after.read('two', item.address)).toEqual([])
  await after.save('one', { ...item, comment: 'Revised comment' })
  expect(after.read('one', item.address)[0]?.comment).toBe('Revised comment')
  await after.remove('one', item.address, [item.id])
  expect(after.read('one', item.address)).toEqual([])
  expect(localStorage.getItem('ordinary-composer-draft')).toBe('keep me')
})
it('keeps image bytes until successful removal and fails closed when a restored image is missing', async () => {
  const { store, files } = imageStore(), batch = new PageBatches(store)
  const region = { ...item, text: '', region: item.anchors![0]!.rect, image: { key: item.id, name: `aione-page-${item.id}.png`, width: 200, height: 100 } }
  const file = new File(['pixels'], region.image.name, { type: 'image/png' })
  await batch.save('one', region, file)
  expect(await new PageBatches(store).files([region], new AbortController().signal)).toEqual([file])
  files.clear()
  await expect(batch.files([region], new AbortController().signal)).rejects.toThrow('区域图片不可用')
  expect(batch.read('one', item.address)).toHaveLength(1)
})
it('rolls back pixels if cancellation lands during capture persistence', async () => {
  const { store, files } = imageStore(), signal = new AbortController()
  const put = store.put
  store.put = async (key, file) => { await put(key, file); signal.abort() }
  const batch = new PageBatches(store)
  const region = { ...item, text: '', region: item.anchors![0]!.rect, image: { key: item.id, name: `aione-page-${item.id}.png`, width: 200, height: 100 } }
  await expect(batch.save('one', region, new File(['pixels'], region.image.name), signal.signal)).rejects.toThrow()
  expect(batch.read('one', item.address)).toEqual([])
  expect(files.size).toBe(0)
})
it('preserves comments and geometry in sent presentation and rejects malformed anchors', () => {
  expect(decodeFileReference(fileReference(item).ref)).toEqual(item)
  const sent = serializeFileReference(fileReference(item).ref, new AbortController().signal)
  expect(sent.text).toContain('User comment: Explain this')
  expect(sent.presentation.data).toEqual(item)
  expect(decodeFileReference(JSON.stringify({ ...item, anchors: [{ page: 3, rect: item.anchors![0]!.rect }] }))).toBeUndefined()
  expect(decodeFileReference(JSON.stringify({ ...item, comment: 'x'.repeat(8193) }))).toBeUndefined()
})
it('preserves existing metadata if the storage quota prevents a new save', async () => {
  const { store } = imageStore(), batches = new PageBatches(store)
  await batches.save('one', item)
  const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
  await expect(batches.save('one', { ...item, comment: 'changed' })).rejects.toThrow('quota')
  spy.mockRestore()
  expect(batches.read('one', item.address)).toEqual([item])
})
