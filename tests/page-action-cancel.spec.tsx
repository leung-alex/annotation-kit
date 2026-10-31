import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import type { PropsLocale } from '../src/host-contracts.ts'
import type { ComposerBridge } from '../src/host-contracts.ts'
import { pageActionComponent } from '../src/client/files/pages/PageSelectionAction.tsx'
import { PageBatches } from '../src/client/files/pages/batches.ts'

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  localStorage.clear()
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [new DOMRect(20, 80, 100, 20)] })
})

it.each(['pdf', 'docx'])('%s keeps an editable document batch outside Composer, retries a failed send, and removes only successful requests', async extension => {
  const add = vi.fn<ComposerBridge['add']>()
  const sendPages = vi.fn<NonNullable<ComposerBridge['sendPages']>>()
    .mockRejectedValueOnce(new Error('Temporarily offline')).mockResolvedValueOnce(undefined)
  const bridge: ComposerBridge = { add, sendPages, hasTarget: () => true, targetKey: () => 'session', subscribe: () => () => undefined, dispose() {} }
  const batches = new PageBatches()
  const Action = pageActionComponent(bridge, batches)
  const t = ((key: string) => key) as PropsLocale<'annotations'>['t']
  const address = `dsh-resource://file/absolute/D:/test.${extension}`
  const screen = render(<div data-textpreview-url={address}>
    <Action absolutePath={`D:/test.${extension}`} t={t} />
    <div data-pdf-page="1"><div data-pdf-text><span>Original text</span></div></div>
  </div>)
  vi.spyOn(screen.container.firstElementChild!, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 600, 600))
  vi.spyOn(screen.container.querySelector('[data-pdf-page]')!, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 40, 600, 560))
  fireEvent(window, new Event('resize'))
  const text = screen.container.querySelector('[data-pdf-text] span')!.firstChild!
  const range = document.createRange()
  range.setStart(text, 0); range.setEnd(text, 8)
  Object.defineProperty(range, 'getBoundingClientRect', { value: () => new DOMRect(20, 80, 100, 20) })
  const selection = window.getSelection()!
  selection.removeAllRanges(); selection.addRange(range)
  fireEvent(document, new Event('selectionchange'))
  fireEvent.click(document.querySelector('[data-page-ask]')!)
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Explain this' } })
  fireEvent.submit(document.querySelector('[data-page-comment]')!)
  await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull())
  expect(batches.read('session', address)[0]?.comment).toBe('Explain this')
  expect(add).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'page.edit 1' }))
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Unsaved edit' } })
  fireEvent.click(document.querySelector('[data-page-comment] button:not([aria-label]):not([type="submit"])')!)
  expect(batches.read('session', address)[0]?.comment).toBe('Explain this')
  fireEvent.click(screen.getByRole('button', { name: 'page.edit 1' }))
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Explain only this selection' } })
  fireEvent.click(screen.getByRole('button', { name: 'page.save' }))
  await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull())
  fireEvent.click(screen.getByRole('button', { name: 'page.send' }))
  await screen.findByText('Temporarily offline')
  expect(batches.read('session', address)[0]?.text).toBe('Original')
  expect(batches.read('session', address)[0]?.comment).toBe('Explain only this selection')
  fireEvent.click(screen.getByRole('button', { name: 'page.send' }))
  await waitFor(() => expect(document.querySelector('[data-page-batch]')).toBeNull())
  expect(sendPages).toHaveBeenCalledTimes(2)
  expect(sendPages.mock.calls[1]![0].expectedTarget).toBe('session')
  expect(batches.read('session', address)).toEqual([])
  expect(add).not.toHaveBeenCalled()
})

it.each(['pdf', 'docx', 'pptx'])('%s reopens an independent saved batch, edits it and deletes it without Composer effects', async extension => {
  const address = `dsh-resource://file/absolute/D:/test.${extension}`
  const batches = new PageBatches()
  await batches.save('session', { version: 2, id: 'saved', address, kind: extension === 'pdf' ? 'pdf' : 'office',
    startPage: 1, endPage: 1, text: 'Saved selection', comment: 'Saved comment',
    anchors: [{ page: 1, rect: { x: 0.1, y: 0.1, width: 0.2, height: 0.05 } }] })
  const add = vi.fn(), sendPages = vi.fn()
  const bridge: ComposerBridge = { add, sendPages, hasTarget: () => true, targetKey: () => 'session', subscribe: () => () => {}, dispose() {} }
  const t = ((key: string) => key) as PropsLocale<'annotations'>['t']
  const mount = () => {
    const Action = pageActionComponent(bridge, new PageBatches())
    const screen = render(<div data-textpreview-url={address}><Action absolutePath={`D:/test.${extension}`} t={t} />
      <div data-pdf-page="1"><div data-pdf-text>Saved selection</div></div></div>)
    vi.spyOn(screen.container.firstElementChild!, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 600, 600))
    vi.spyOn(screen.container.querySelector('[data-pdf-page]')!, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 40, 600, 560))
    fireEvent(window, new Event('resize'))
    return screen
  }
  let screen = mount()
  fireEvent.click(await screen.findByRole('button', { name: 'page.edit 1' }))
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Edited after reload' } })
  fireEvent.click(screen.getByRole('button', { name: 'page.save' }))
  await waitFor(() => expect(new PageBatches().read('session', address)[0]?.comment).toBe('Edited after reload'))
  screen.unmount()
  screen = mount()
  fireEvent.click(await screen.findByRole('button', { name: 'page.edit 1' }))
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Edited after reload')
  fireEvent.click(screen.getByRole('button', { name: 'page.delete' }))
  await waitFor(() => expect(new PageBatches().read('session', address)).toEqual([]))
  expect(add).not.toHaveBeenCalled()
  expect(sendPages).not.toHaveBeenCalled()
})

it('shows missing send capability before a saved batch can be sent', async () => {
  const address = 'dsh-resource://file/absolute/D:/test.pdf', batches = new PageBatches()
  await batches.save('session', { version: 2, id: 'saved', address, kind: 'pdf', startPage: 1, endPage: 1, text: 'Text', comment: 'Comment' })
  const Action = pageActionComponent({ targetKey: () => 'session', subscribe: () => () => {} }, batches)
  const t = ((key: string) => key) as PropsLocale<'annotations'>['t']
  const screen = render(<div data-textpreview-url={address}><Action absolutePath="D:/test.pdf" t={t} /></div>)
  vi.spyOn(screen.container.firstElementChild!, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 600, 600))
  fireEvent(window, new Event('resize'))
  expect(await screen.findByText('page.senderUnavailable')).toBeTruthy()
  expect((screen.getByRole('button', { name: 'page.send' }) as HTMLButtonElement).disabled).toBe(true)
  expect(batches.read('session', address)).toHaveLength(1)
})

it('the PPT keyboard shortcut cannot bypass the unavailable sending capability', async () => {
  const address = 'dsh-resource://file/absolute/D:/test.pptx'
  const Action = pageActionComponent({ targetKey: () => 'session', subscribe: () => () => {} })
  const t = ((key: string) => key) as PropsLocale<'annotations'>['t']
  const screen = render(<div data-textpreview-url={address}><Action absolutePath="D:/test.pptx" t={t} />
    <div data-pdf-page="1"><div data-pdf-text><span>Slide title</span></div></div></div>)
  vi.spyOn(screen.container.firstElementChild!, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 600, 600))
  fireEvent(window, new Event('resize'))
  const range = document.createRange()
  range.selectNodeContents(screen.container.querySelector('[data-pdf-text] span')!)
  Object.defineProperty(range, 'getBoundingClientRect', { value: () => new DOMRect(20, 80, 100, 20) })
  const selection = window.getSelection()!
  selection.removeAllRanges(); selection.addRange(range)
  fireEvent(document, new Event('selectionchange'))
  expect(screen.getByText('page.senderUnavailable')).toBeTruthy()
  expect(document.querySelector<HTMLButtonElement>('[data-page-ask]')!.disabled).toBe(true)
  fireEvent.keyDown(window, { key: 'x', ctrlKey: true, shiftKey: true })
  expect(screen.queryByRole('textbox')).toBeNull()
  expect(screen.getByText('page.senderUnavailable')).toBeTruthy()
})

it('a rapid duplicate send cannot replace the cancellation handle of the admitted operation', async () => {
  const address = 'dsh-resource://file/absolute/D:/test.pdf', batches = new PageBatches()
  const item = { version: 2 as const, id: 'saved', address, kind: 'pdf' as const, startPage: 1, endPage: 1, text: 'Text', comment: 'Comment' }
  await batches.save('session', item)
  let target = 'session', rejectPending: (error: Error) => void = () => {}
  const listeners = new Set<() => void>()
  const sendPages = vi.fn<NonNullable<ComposerBridge['sendPages']>>(() => new Promise<void>((_resolve, reject) => { rejectPending = reject }))
  const Action = pageActionComponent({ targetKey: () => target, sendPages,
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener) } } }, batches)
  const t = ((key: string) => key) as PropsLocale<'annotations'>['t']
  const screen = render(<div data-textpreview-url={address}><Action absolutePath="D:/test.pdf" t={t} /></div>)
  vi.spyOn(screen.container.firstElementChild!, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 600, 600))
  fireEvent(window, new Event('resize'))
  const send = (screen.getByRole('button', { name: 'page.send' }) as HTMLButtonElement)
  act(() => { send.click(); send.click() })
  await waitFor(() => expect(sendPages).toHaveBeenCalledOnce())
  const signal = sendPages.mock.calls[0]![0].signal
  await act(async () => { target = 'elsewhere'; for (const listener of listeners) listener() })
  expect(signal.aborted).toBe(true)
  await act(async () => { rejectPending(new Error('Cancelled')) })
  expect(new PageBatches().read('session', address)).toEqual([item])
})

it('submits a PowerPoint quick request with its distinct copy and preserves the selected snapshot on failure', async () => {
  const sendPages = vi.fn<NonNullable<ComposerBridge['sendPages']>>().mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce(undefined)
  const bridge: ComposerBridge = { add: vi.fn(), sendPages, hasTarget: () => true, targetKey: () => 'session', subscribe: () => () => undefined, dispose() {} }
  const Action = pageActionComponent(bridge)
  const t = ((key: string) => key) as PropsLocale<'annotations'>['t']
  const screen = render(<div data-textpreview-url="dsh-resource://file/absolute/D:/test.pptx">
    <Action absolutePath="D:/test.pptx" t={t} />
    <div data-pdf-page="1"><div data-pdf-text><span>Slide title</span></div></div>
  </div>)
  vi.spyOn(screen.container.firstElementChild!, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 600, 600))
  fireEvent(window, new Event('resize'))
  const range = document.createRange()
  range.selectNodeContents(screen.container.querySelector('[data-pdf-text] span')!)
  Object.defineProperty(range, 'getBoundingClientRect', { value: () => new DOMRect(20, 80, 100, 20) })
  const selection = window.getSelection()!
  selection.removeAllRanges(); selection.addRange(range)
  fireEvent(document, new Event('selectionchange'))
  fireEvent.click(document.querySelector('[data-page-ask]')!)
  fireEvent.change(screen.getByRole('textbox', { name: 'page.changes' }), { target: { value: 'Shorten this title' } })
  fireEvent.click(screen.getByRole('button', { name: 'page.submit' }))
  await screen.findByText('Offline')
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Shorten this title')
  fireEvent.click(screen.getByRole('button', { name: 'page.submit' }))
  await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull())
  expect(sendPages.mock.calls[1]![0].items[0]?.text).toBe('Slide title')
  expect(bridge.add).not.toHaveBeenCalled()
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('cancels pending admission when the selected page text changes without replacing the text node', async () => {
  const add = vi.fn<ComposerBridge['add']>(() => new Promise(() => undefined))
  const bridge: ComposerBridge = { add, hasTarget: () => true, targetKey: () => 'session', subscribe: () => () => undefined, dispose() {} }
  const batches = new PageBatches()
  const save = vi.spyOn(batches, 'save').mockImplementation(() => new Promise(() => undefined))
  const Action = pageActionComponent(bridge, batches)
  const t = ((key: string) => key) as PropsLocale<'annotations'>['t']
  const { container } = render(<div data-textpreview-url="dsh-resource://file/absolute/D:/test.pdf">
    <Action absolutePath="D:/test.pdf" t={t} />
    <div data-pdf-page="1"><div data-pdf-text><span>Original text</span></div></div>
  </div>)
  const text = container.querySelector('[data-pdf-text] span')!.firstChild!
  const range = document.createRange()
  range.setStart(text, 0); range.setEnd(text, 8)
  Object.defineProperty(range, 'getBoundingClientRect', { value: () => new DOMRect(20, 80, 100, 20) })
  vi.spyOn(container.firstElementChild!, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 600, 600))
  fireEvent(window, new Event('resize'))
  const selection = window.getSelection()!
  selection.removeAllRanges(); selection.addRange(range)
  fireEvent(document, new Event('selectionchange'))
  fireEvent.click(document.querySelector('[data-page-ask]')!)
  fireEvent.change(document.querySelector('[data-page-comment] textarea')!, { target: { value: 'Explain this text' } })
  fireEvent.submit(document.querySelector('[data-page-comment]')!)
  expect(save).toHaveBeenCalledOnce()
  expect(add).not.toHaveBeenCalled()
  const signal = save.mock.calls[0]![3]!
  expect(signal.aborted).toBe(false)
  // PDF.js moves an empty selection sentinel on mouseup; this is not a content change.
  await act(async () => {
    const sentinel = document.createElement('div')
    sentinel.className = 'endOfContent'
    container.querySelector('[data-pdf-text]')!.append(sentinel)
    sentinel.remove()
  })
  expect(signal.aborted).toBe(false)
  await act(async () => { text.textContent = 'Changed text' })
  expect(signal.aborted).toBe(true)
  expect(document.querySelector('[data-page-comment]')).toBeNull()
})
