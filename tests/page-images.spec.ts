import { afterEach, expect, it, vi } from 'vitest'
import type { SessionId } from '../src/host-contracts.ts'
import type { ComposerAttachment, DraftAttachmentId, InputActions, InputState } from '../src/host-contracts.ts'
import { PageImages } from '../src/client/files/pages/images.ts'
import type { PageImageStore } from '../src/client/files/pages/image-store.ts'
import type { PageSnapshot } from '../src/client/files/pages/snapshot.ts'
import type { DraftFactory } from '../src/client/composer/attachments.ts'
import { fileReference } from '../src/client/files/references.ts'

afterEach(() => { vi.unstubAllGlobals() })
const item: PageSnapshot = { version: 2, id: 'region-test', address: 'dsh-resource://file/absolute/D:/doc.pdf', kind: 'pdf', text: '', startPage: 1, endPage: 1,
  region: { x: 0, y: 0, width: .5, height: .5 }, image: { key: 'region-test', name: 'aione-page-region-test.png', width: 200, height: 100 } }
function fixture() {
  vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:test'), revokeObjectURL: vi.fn() })
  const blobs = new Map<string, File>()
  const store: PageImageStore = { put: async (key, file) => { blobs.set(key, file) }, get: async key => blobs.get(key), remove: async key => { blobs.delete(key) } }
  const drafts = new Map<DraftAttachmentId, ComposerAttachment>()
  const factory: DraftFactory = {
    createDrafts: (_session, files) => files.map(file => {
      const id = crypto.randomUUID() as DraftAttachmentId
      const draft = { id, kind: 'image', file } as ComposerAttachment
      drafts.set(id, draft); return draft
    }),
    releaseDraftAttachment: id => { drafts.delete(id) },
    resolveDraftAttachments: ids => ids.flatMap(id => drafts.get(id) ? [drafts.get(id)!] : []),
  }
  const ref = fileReference(item)
  const input = { phase: 'plain', attachmentIds: [], draftRev: 1, occurrences: [{ ...ref, offset: 0, length: ref.clipboardText.length }] } as unknown as InputState
  const mutable = input as unknown as { attachmentIds: DraftAttachmentId[]; occurrences: InputState['occurrences'] }
  const actions = { addAttachments: (ids: DraftAttachmentId[]) => { mutable.attachmentIds.push(...ids); return true },
    removeAttachment: (id: DraftAttachmentId) => { mutable.attachmentIds = mutable.attachmentIds.filter(x => x !== id); return true } } as unknown as InputActions
  return { store, factory, drafts, input, mutable, actions, session: 'test-session' as SessionId }
}

it('restores image bytes after restart, groups them, removes and readmits them on undo', async () => {
  const f = fixture()
  const before = new PageImages(f.store)
  const file = new File(['saved pixels'], item.image!.name, { type: 'image/png' })
  await before.save(item, file); before.dispose()
  const after = new PageImages(f.store)
  expect(() => after.validate(item)).toThrow('尚未恢复')
  after.reconcile(f.session, f.input, f.actions, f.factory)
  await vi.waitFor(() => expect(after.preview(item)?.file).toBe(file))
  after.reconcile(f.session, f.input, f.actions, f.factory)
  expect(() => after.validate(item)).not.toThrow()
  expect(after.imageIdsFor(f.input).size).toBe(1)
  const refs = f.input.occurrences
  f.mutable.occurrences = []
  after.reconcile(f.session, f.input, f.actions, f.factory)
  expect(f.mutable.attachmentIds).toEqual([])
  expect(f.drafts.size).toBe(0)
  f.mutable.occurrences = refs
  after.reconcile(f.session, f.input, f.actions, f.factory)
  expect(f.drafts.size).toBe(1)
  expect(() => after.validate(item)).not.toThrow()
  after.dispose()
})

it('fails closed when persisted region pixels are unavailable', async () => {
  const f = fixture(), images = new PageImages(f.store)
  images.reconcile(f.session, f.input, f.actions, f.factory)
  await vi.waitFor(() => expect(images.preview(item)?.error).toMatchObject({ key: 'error.imageDraftLost' }))
  expect(() => images.validate(item)).toThrow('丢失')
  expect(f.drafts.size).toBe(0)
  images.dispose()
})

it('does not detach screenshots while a send is pending or fails back to the same draft', async () => {
  const f = fixture(), images = new PageImages(f.store)
  await images.save(item, new File(['pixels'], item.image!.name, { type: 'image/png' }))
  images.reconcile(f.session, f.input, f.actions, f.factory)
  await vi.waitFor(() => expect(images.preview(item)?.file).toBeTruthy())
  images.reconcile(f.session, f.input, f.actions, f.factory)
  const ids = [...f.input.attachmentIds]
  images.reconcile(f.session, { ...f.input, phase: 'submitting', occurrences: [] }, f.actions, f.factory)
  images.reconcile(f.session, f.input, f.actions, f.factory)
  expect(f.input.attachmentIds).toEqual(ids)
  expect(() => images.validate(item)).not.toThrow()
  images.dispose()
})

it('contains attachment admission errors without repeatedly retrying or sending missing pixels', async () => {
  const f = fixture(), images = new PageImages(f.store)
  await images.save(item, new File(['pixels'], item.image!.name, { type: 'image/png' }))
  const add = vi.fn(() => false)
  f.actions.addAttachments = add
  images.reconcile(f.session, f.input, f.actions, f.factory)
  await vi.waitFor(() => expect(images.preview(item)?.file).toBeTruthy())
  expect(() => images.reconcile(f.session, f.input, f.actions, f.factory)).not.toThrow()
  images.reconcile(f.session, f.input, f.actions, f.factory)
  expect(add).toHaveBeenCalledOnce()
  expect(f.drafts.size).toBe(0)
  expect(() => images.validate(item)).toThrow('无法恢复')
  images.dispose()
})

it('cleans persisted pixels only after a successful send has released its image drafts', async () => {
  const f = fixture(), images = new PageImages(f.store)
  await images.save(item, new File(['pixels'], item.image!.name, { type: 'image/png' }))
  images.reconcile(f.session, f.input, f.actions, f.factory)
  await vi.waitFor(() => expect(images.preview(item)?.file).toBeTruthy())
  images.reconcile(f.session, f.input, f.actions, f.factory)
  f.mutable.occurrences = []
  f.mutable.attachmentIds = []
  f.drafts.clear()
  images.reconcile(f.session, f.input, f.actions, f.factory)
  expect(images.preview(item)).toBeUndefined()
  expect(await f.store.get(item.id, item.image!.name)).toBeUndefined()
  images.dispose()
})
