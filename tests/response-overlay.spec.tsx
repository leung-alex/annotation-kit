import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { PropsLocale } from '../src/host-contracts.ts'
import type { ComposerBridge } from '../src/host-contracts.ts'
import { zh } from '../src/client/locales.ts'
import { ResponseOverlay } from '../src/client/responses/ResponseOverlay.tsx'
import { ResponseController } from '../src/client/responses/controller.ts'
import { projectResponseText } from '../src/client/responses/selection.ts'
import type { ResponseAnnotationSnapshot } from '../src/client/responses/references.ts'

const rangeRects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects')
const t = ((key: keyof typeof zh) => zh[key]) as PropsLocale<'annotations'>['t']
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => [new DOMRect(220, 210, 56, 20)] })
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    if (this.hasAttribute('data-response-add')) return new DOMRect(0, 0, 78, 28)
    return new DOMRect(200, 100, 320, 480)
  })
})
afterEach(() => {
  cleanup()
  window.getSelection()?.removeAllRanges()
  document.body.replaceChildren()
  if (rangeRects) Object.defineProperty(Range.prototype, 'getClientRects', rangeRects)
  else Reflect.deleteProperty(Range.prototype, 'getClientRects')
  vi.unstubAllGlobals()
})

function fixture() {
  const frame = document.createElement('div')
  frame.dataset.chatFlow = ''
  frame.dataset.conversationScroll = ''
  const root = document.createElement('div')
  root.dataset.responseSource = ''
  root.textContent = '引用😀'
  root.scrollIntoView = vi.fn()
  const input = document.createElement('textarea')
  frame.append(root, input)
  document.body.append(frame)
  let items: ResponseAnnotationSnapshot[] = []
  const composer: ComposerBridge = {
    targetKey: () => 's1', hasTarget: () => true, subscribe: () => () => {}, dispose: () => {},
    add: async request => { if (request.responseSelection) items.push(request.responseSelection) },
    responses: {
      read: () => items,
      replace: next => { items = items.map(item => item.id === next.id ? next : item) },
      remove: (_session, id) => { items = items.filter(item => item.id !== id) },
      clear: () => { items = [] }, focus: () => input.focus(),
    },
  }
  const controller = new ResponseController(composer, async () => {})
  controller.register({ root, reveal: () => {}, source: { sessionId: 's1', nodeKey: 'n1', nodeId: 'n1', turn: 1, step: 1, seq: 1, blockIndex: 0, text: '引用😀' } })
  const view = render(<ResponseOverlay controller={controller} sessionId="s1" t={t} />)
  const range = document.createRange()
  range.selectNodeContents(root)
  window.getSelection()!.addRange(range)
  fireEvent(document, new Event('selectionchange'))
  return { controller, composer, root, input, view }
}

it('keeps the selection when keyboard-focusing Add, retains an empty reference on dismissal and cleans up local markers', async () => {
  const { composer, root, input, view } = fixture()
  const add = screen.getByRole('button', { name: '添加到会话' })
  fireEvent.keyDown(document, { key: 'Tab' })
  expect(document.activeElement).toBe(add)
  fireEvent(document, new Event('selectionchange'))
  fireEvent.click(add)
  const comment = await screen.findByRole('textbox', { name: zh['response.placeholder'] })
  expect(document.activeElement).toBe(comment)
  expect(composer.responses!.read('s1')).toHaveLength(1)
  fireEvent.pointerDown(input)
  expect(screen.queryByRole('textbox', { name: zh['response.placeholder'] })).toBeNull()
  expect(composer.responses!.read('s1')[0]?.comment).toBe('')
  const marker = screen.getByRole('button', { name: '编辑批注 1' })
  expect(marker.closest('[data-response-source]')).toBe(root)
  expect(projectResponseText(root).text).toBe('引用😀')
  view.unmount()
  expect(root.querySelector('button')).toBeNull()
  expect(root.textContent).toBe('引用😀')
})

it('fences active editors against reference removal and reports stale source selections before inserting', async () => {
  const { composer, controller, root } = fixture()
  root.firstChild!.textContent = '内容已经改变'
  fireEvent.click(screen.getByRole('button', { name: '添加到会话' }))
  await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())
  expect(composer.responses!.read('s1')).toHaveLength(0)
  root.firstChild!.textContent = '引用😀'
  const range = document.createRange()
  range.selectNodeContents(root)
  window.getSelection()!.removeAllRanges()
  window.getSelection()!.addRange(range)
  fireEvent(document, new Event('selectionchange'))
  fireEvent.click(screen.getByRole('button', { name: '添加到会话' }))
  await screen.findByRole('textbox', { name: zh['response.placeholder'] })
  act(() => { composer.responses!.clear('s1'); controller.changed() })
  expect(screen.queryByRole('textbox', { name: zh['response.placeholder'] })).toBeNull()
  expect(screen.queryByRole('button', { name: '编辑批注 1' })).toBeNull()
})
