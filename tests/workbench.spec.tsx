import { afterEach, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { fireEvent } from '@testing-library/react'
import { AnnotationButton, AnnotationOverlay, type AnnotationProps } from '../src/client/Workbench.tsx'
import { AnnotationsModel } from '../src/client/model.ts'
import type { DesktopAnnotationEvent, DesktopAnnotations } from '../src/shared/desktop.ts'
import type { ComposerBridge } from '../src/host-contracts.ts'
import { en } from '../src/client/locales.ts'

afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals() })
it('uses a portal at the target, admits on Enter, preserves IME composition, and never mounts a browser panel', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  const listeners = new Set<(event: DesktopAnnotationEvent) => void>()
  const desktop: DesktopAnnotations = { protocolVersion: 1,
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
    setMode: vi.fn(async () => ({ documentEpoch: 'epoch' })),
    capture: vi.fn(async () => ({ png: new Uint8Array([137, 80]), width: 800, height: 600, viewportWidth: 800, viewportHeight: 600 })) }
  const bridge: ComposerBridge = { add: vi.fn(async () => {}), hasTarget: () => true, targetKey: () => 's', subscribe: () => () => {}, dispose() {} }
  const model = new AnnotationsModel(desktop, bridge, () => 'lease')
  const surface = { id: 'right', source: 'sidebar' as const, viewportId: 'viewport', title: 'Page', enabled: true }
  const host = document.createElement('div'), viewport = document.createElement('div')
  viewport.id = 'viewport'; document.body.append(host, viewport)
  vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue(new DOMRect(600, 100, 800, 600))

  const t = ((key: keyof typeof en) => en[key]) as AnnotationProps['t']
  const root = createRoot(host)
  try {
    await act(async () => { root.render(<><AnnotationButton surface={surface} model={model} t={t} /><AnnotationOverlay surface={surface} model={model} t={t} /></>) })
    await act(async () => { host.querySelector<HTMLButtonElement>('button')!.click() })
    expect(host.children).toHaveLength(1)
    await act(async () => { for (const listener of listeners) listener({ kind: 'selection', source: 'sidebar', lease: 'lease', documentEpoch: 'epoch', selection: {
      kind: 'element', rect: { x: 20, y: 100, width: 400, height: 50 }, anchor: { x: 100, y: 100 }, viewport: { width: 800, height: 600 }, scroll: { x: 0, y: 0 }, url: 'https://example.test/', title: 'Page' } }) })
    const form = document.querySelector<HTMLFormElement>('[data-aione-annotation-comment]')!
    expect(form).not.toBeNull()
    expect(host.contains(form)).toBe(false)
    expect(document.activeElement).toBe(form.querySelector('textarea'))
    await act(async () => { fireEvent.change(form.querySelector('textarea')!, { target: { value: 'Comment' } }) })
    await act(async () => { fireEvent.keyDown(form.querySelector('textarea')!, { key: 'Enter', isComposing: true }) })
    expect(bridge.add).not.toHaveBeenCalled()
    await act(async () => { fireEvent.keyDown(form.querySelector('textarea')!, { key: 'Enter' }) })
    expect(bridge.add).toHaveBeenCalledOnce()
    expect(document.querySelector('[data-aione-annotation-comment]')).toBeNull()
    expect(document.querySelector('[data-aione-annotation-workbench]')).toBeNull()
  } finally { await act(async () => { root.unmount() }); model.dispose() }
})
