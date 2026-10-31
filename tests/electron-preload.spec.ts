import { afterEach, expect, it, vi } from 'vitest'
import { renderAnnotationGuestPreload } from '../src/electron/build-preload.mjs'

afterEach(() => vi.unstubAllGlobals())

it('keeps a selection through Electron capture resize notifications, but clears on real viewport changes and scrolling', () => {
  const listeners = new Map<string, (event: unknown, request: unknown) => void>()
  const send = vi.fn()
  const ipcRenderer = { on: (channel: string, listener: (event: unknown, request: unknown) => void) => listeners.set(channel, listener), send }
  const run = new Function('require', renderAnnotationGuestPreload())
  run((name: string) => { expect(name).toBe('electron'); return { ipcRenderer } })
  listeners.get('annotation-kit:annotation-guest-command')!(undefined, { kind: 'mode', mode: 'element', epoch: 'document-1' })
  window.dispatchEvent(new Event('resize'))
  expect(send).not.toHaveBeenCalled()
  vi.stubGlobal('innerWidth', window.innerWidth + 20)
  window.dispatchEvent(new Event('resize'))
  expect(send).toHaveBeenCalledExactlyOnceWith('annotation-kit:annotation-guest-selection', { epoch: 'document-1', selection: null })
  window.dispatchEvent(new Event('resize'))
  expect(send).toHaveBeenCalledTimes(1)
  const scroller = document.createElement('div')
  document.body.append(scroller)
  scroller.dispatchEvent(new Event('scroll'))
  expect(send).toHaveBeenCalledTimes(2)
})
