import { describe, expect, it, vi } from 'vitest'
import { AnnotationsModel } from '../src/client/model.ts'
import type { ComposerBridge } from '../src/host-contracts.ts'
import type { DesktopAnnotationEvent, DesktopAnnotations, BrowserAnnotationSelection } from '../src/shared/desktop.ts'
import type { BrowserSurfaceHandle } from '../src/shared/surface.ts'

const selection: BrowserAnnotationSelection = {
  kind: 'element', selector: '#search', element: { tagName: 'input', attributes: { placeholder: 'Search the web' }, path: 'form > input', frame: 'top document' },
  rect: { x: 12, y: 20, width: 110, height: 38 }, viewport: { width: 800, height: 600 }, scroll: { x: 0, y: 0 },
  url: 'https://example.test/', title: 'Example', anchor: { x: 40, y: 30 },
}
const captured = { png: new Uint8Array([137, 80, 78, 71]), width: 800, height: 600, viewportWidth: 800, viewportHeight: 600 }
function fixture() {
  const listeners = new Set<(event: DesktopAnnotationEvent) => void>()
  let session = 'session-1'
  const desktop: DesktopAnnotations = { protocolVersion: 1,
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
    setMode: vi.fn(async () => ({ documentEpoch: 'epoch-1' })), capture: vi.fn(async () => captured),
  }
  const composer: ComposerBridge = { add: vi.fn(async () => {}), hasTarget: () => true,
    targetKey: () => session, subscribe: () => () => {}, dispose: vi.fn() }
  const surface: BrowserSurfaceHandle = { id: 'right-1', source: 'sidebar', viewportId: 'viewport', title: 'Example', url: selection.url, enabled: true }
  const model = new AnnotationsModel(desktop, composer, () => 'lease-1')
  const emit = (event: DesktopAnnotationEvent) => { for (const listener of listeners) listener(event) }
  const select = () => { emit({ kind: 'selection', source: 'sidebar', lease: 'lease-1', documentEpoch: 'epoch-1', selection }); model.setComment(surface.id, 'What is the placeholder?') }
  return { model, desktop, composer, surface, select, emit, switchSession: () => { session = 'session-2'; model.refresh() } }
}

describe('direct browser comment to Composer', () => {
  it('adds exactly one semantic packet with its real PNG, without an intermediate batch', async () => {
    const f = fixture()
    try {
      await f.model.toggle(f.surface); f.select(); await f.model.save(f.surface)
      expect(f.desktop.capture).toHaveBeenCalledWith('lease-1', 'epoch-1', selection, 1)
      expect(f.composer.add).toHaveBeenCalledOnce()
      expect(vi.mocked(f.composer.add).mock.calls[0]?.[0]).toMatchObject({ text: '', expectedTarget: 'session-1', focus: false,
        annotations: [{ selection, comment: 'What is the placeholder?', image: expect.any(File) }], images: [expect.any(File)] })
      expect(f.model.getSnapshot().drafts[f.surface.id]).toMatchObject({ active: true, saving: false, comment: '' })
      expect(f.model.getSnapshot().drafts[f.surface.id]?.selection).toBeUndefined()
      f.select(); await f.model.save(f.surface)
      expect(f.composer.add).toHaveBeenCalledTimes(2)
    } finally { f.model.dispose() }
  })
  it('retains the selected target and comment when Composer refuses, then retries', async () => {
    const f = fixture()
    try {
      await f.model.toggle(f.surface); f.select()
      vi.mocked(f.composer.add).mockRejectedValueOnce(new Error('Composer busy'))
      await f.model.save(f.surface)
      expect(f.model.getSnapshot().drafts[f.surface.id]).toMatchObject({ selection, saving: false, comment: 'What is the placeholder?', error: expect.objectContaining({ message: 'Composer busy' }) })
      await f.model.save(f.surface)
      expect(f.composer.add).toHaveBeenCalledTimes(2)
    } finally { f.model.dispose() }
  })
  for (const reason of ['navigation', 'session', 'cancel', 'dispose'] as const) {
    it(`does not add a screenshot after ${reason} invalidates a pending capture`, async () => {
      const f = fixture()
      try {
        await f.model.toggle(f.surface); f.select()
        let finish!: (value: typeof captured) => void
        vi.mocked(f.desktop.capture).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
        const saving = f.model.save(f.surface)
        if (reason === 'navigation') f.emit({ kind: 'navigation', source: 'sidebar', lease: 'lease-1', documentEpoch: 'epoch-2' })
        else if (reason === 'session') f.switchSession()
        else if (reason === 'cancel') f.model.cancel(f.surface.id)
        else f.model.dispose()
        finish(captured); await saving
        expect(f.composer.add).not.toHaveBeenCalled()
      } finally { f.model.dispose() }
    })
  }
  it('ignores a second target while capture is pending, and does not duplicate on double submit', async () => {
    const f = fixture()
    try {
      await f.model.toggle(f.surface); f.select()
      let finish!: (value: typeof captured) => void
      vi.mocked(f.desktop.capture).mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
      const saving = f.model.save(f.surface)
      f.select(); await f.model.save(f.surface); finish(captured); await saving
      expect(f.composer.add).toHaveBeenCalledOnce()
    } finally { f.model.dispose() }
  })
  it('edits an existing comment in place without creating another image attachment', async () => {
    const f = fixture()
    try {
      await f.model.toggle(f.surface); f.select(); await f.model.save(f.surface)
      const entry = vi.mocked(f.composer.add).mock.calls[0]![0].annotations![0]!
      const commit = vi.fn()
      expect(f.model.edit(entry, commit)).toBe(true)
      f.model.setComment(f.surface.id, 'Revised comment'); await f.model.save(f.surface)
      expect(commit).toHaveBeenCalledWith('Revised comment')
      expect(f.desktop.capture).toHaveBeenCalledOnce()
      expect(f.composer.add).toHaveBeenCalledOnce()
    } finally { f.model.dispose() }
  })
  it('does not revive an old mode response after navigation', async () => {
    const f = fixture()
    try {
      await f.model.toggle(f.surface)
      let reject!: (error: Error) => void
      vi.mocked(f.desktop.setMode).mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail }))
      const switching = f.model.setMode(f.surface, 'region')
      f.emit({ kind: 'navigation', source: 'sidebar', lease: 'lease-1', documentEpoch: 'epoch-2' })
      reject(new Error('navigated')); await switching
      expect(f.model.getSnapshot().drafts[f.surface.id]).toMatchObject({ active: false, epoch: 'epoch-2' })
    } finally { f.model.dispose() }
  })
})
