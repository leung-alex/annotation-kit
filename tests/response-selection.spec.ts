import { afterEach, describe, expect, it, vi } from 'vitest'
import { prefixHash, projectResponseText, rangesForAnchor, readResponseSelection, selectionCurrent, type ResponseSurface } from '../src/client/responses/selection.ts'
import { assertResponseCapacity, decodeResponseReference, RESPONSE_SOURCE, responseReference, responseSelections, serializeResponseReference } from '../src/client/responses/references.ts'
import { ResponseController } from '../src/client/responses/controller.ts'
import type { ComposerBridge } from '../src/host-contracts.ts'
import type { ResponseAnnotationSnapshot } from '../src/client/responses/references.ts'

afterEach(() => { document.body.replaceChildren(); window.getSelection()?.removeAllRanges() })

function surface(html: string, nodeKey = 'assistant-1', blockIndex = 0): ResponseSurface {
  const root = document.createElement('div')
  root.innerHTML = html
  document.body.append(root)
  root.scrollIntoView = vi.fn()
  return { root, source: { sessionId: 'session-1', nodeKey, nodeId: nodeKey, turn: 1, step: 0, seq: 10, blockIndex, text: html }, reveal: vi.fn() }
}
function select(item: ResponseSurface, start: number, end: number) {
  const projection = projectResponseText(item.root)
  const range = document.createRange()
  const first = projection.segments.find(segment => segment.end > start)!
  const last = [...projection.segments].reverse().find(segment => segment.start < end)!
  range.setStart(first.node, start - first.start)
  range.setEnd(last.node, end - last.start)
  return readResponseSelection(range, [item], item.source.sessionId)!
}

describe('assistant visible text coordinates', () => {
  it('preserves CJK, emoji, duplicate text, paragraph boundaries and literal code whitespace', () => {
    const item = surface('<p>中文😀 重复</p><p>重复</p><pre><code>  a\n\tb\n</code><button>Copy</button></pre>')
    const projection = projectResponseText(item.root)
    expect(projection.text).toBe('中文😀 重复\n重复\n  a\n\tb\n')
    const start = projection.text.indexOf('重复', 8)
    const selection = select(item, start, projection.text.length)
    expect(selection.snapshot.text).toBe('重复\n  a\n\tb\n')
    expect(selection.snapshot.anchors[0]).toMatchObject({ start, end: projection.text.length })
    expect(selection.ranges.map(range => range.toString()).join('')).toBe('重复  a\n\tb\n')
  })

  it('excludes hidden content and code toolbars and separates table cells and rows', () => {
    const item = surface('<div data-code-block-banner>typescript<button>Copy</button></div><p>A<span hidden>SECRET</span><span style="display:none">HIDDEN</span><span aria-hidden="true">ICON</span>B</p><table><tbody><tr><td>甲</td><td>乙</td></tr><tr><td>丙</td><td>丁</td></tr></tbody></table>')
    expect(projectResponseText(item.root).text).toBe('AB\n\t甲\t乙\n\t丙\t丁')
    const selection = select(item, 0, projectResponseText(item.root).text.length)
    expect(selection.snapshot.text).not.toMatch(/SECRET|HIDDEN|ICON|Copy|typescript/u)
  })

  it('accepts multiple text blocks in one node but rejects boundaries in another node or unregistered text', () => {
    const one = surface('<p>one</p>'), two = surface('<p>two</p>', 'assistant-1', 2), other = surface('other', 'assistant-2')
    const range = document.createRange()
    range.setStart(one.root.firstChild!.firstChild!, 1)
    range.setEnd(two.root.firstChild!.firstChild!, 2)
    expect(readResponseSelection(range, [one, two, other], 'session-1')?.snapshot.text).toBe('ne\n\ntw')
    range.setEnd(other.root.firstChild!, 3)
    expect(readResponseSelection(range, [one, two, other], 'session-1')).toBeUndefined()
    expect(readResponseSelection(range, [one], 'session-1')).toBeUndefined()
    expect(readResponseSelection(range, [one, two, other], 'session-2')).toBeUndefined()
  })

  it('relocates through an equivalent DOM render and appended streaming text, rejecting changed prefixes', () => {
    const item = surface('<p>first same same</p>')
    const selection = select(item, 11, 15)
    expect(selection.snapshot.text).toBe('same')
    item.root.innerHTML = '<p>first <strong>same</strong> same appended</p>'
    expect(selectionCurrent(selection)).toBe(true)
    expect(rangesForAnchor(projectResponseText(item.root), selection.snapshot.anchors[0]!).map(range => range.toString()).join('')).toBe('same')
    item.root.innerHTML = '<p>other same same appended</p>'
    expect(selectionCurrent(selection)).toBe(false)
  })
})

describe('durable response reference', () => {
  it('round trips a fixed quote and transports only selection, comment and provenance', () => {
    const item = surface('DO NOT SEND THIS. 用户选择😀. HIDDEN HISTORY')
    const snapshot = { ...select(item, 18, 24).snapshot, comment: '说明这部分' }
    const reference = responseReference(snapshot, 'Response annotation')
    const restored = decodeResponseReference(JSON.parse(JSON.stringify(reference)).ref)
    item.root.remove()
    expect(restored).toEqual(snapshot)
    const serialized = serializeResponseReference(reference.ref, new AbortController().signal)
    expect(serialized.text).toContain(snapshot.text)
    expect(serialized.text).toContain(snapshot.comment)
    expect(serialized.text).not.toContain('HIDDEN HISTORY')
    expect(serialized.presentation.data).toEqual(snapshot)
  })

  it('rejects malformed positions, byte overflow, and more than 32 references', () => {
    const snapshot = select(surface('hello'), 0, 5).snapshot
    const reference = responseReference(snapshot, 'Response annotation')
    expect(decodeResponseReference(JSON.stringify({ ...snapshot, anchors: [{ ...snapshot.anchors[0], start: 9 }] }))).toBeUndefined()
    const long = '中'.repeat(24_000)
    expect(() => responseReference({ ...snapshot, text: long, anchors: [{ ...snapshot.anchors[0]!, text: long, start: 0, end: long.length }] }, 'label')).toThrow()
    const occurrences = Array.from({ length: 32 }, (_, index) => ({ ...reference, id: `r${index}`, offset: index * 2, length: 2 }))
    expect(() => assertResponseCapacity({ occurrences }, reference.ref)).toThrow()
    expect(() => assertResponseCapacity({ occurrences }, reference.ref, snapshot.id)).not.toThrow()
    expect(responseSelections({ occurrences: [{ ...reference, id: 'r', offset: 5, length: 7 }], draftRev: 3 })[0]?.span).toEqual({ start: 5, end: 6, draftRev: 3 })
    expect(reference.source).toBe(RESPONSE_SOURCE)
  })
})

describe('interaction lifecycle', () => {
  function setup() {
    let target = 'session-1'
    let items: ResponseAnnotationSnapshot[] = []
    const add = vi.fn(async (request: Parameters<ComposerBridge['add']>[0]) => { if (request.responseSelection) items.push(request.responseSelection) })
    const composer: ComposerBridge = { add, hasTarget: () => true, targetKey: () => target, subscribe: () => () => {}, dispose: () => {},
      responses: { read: () => items, replace: next => { items = items.map(item => item.id === next.id ? { ...item, comment: next.comment } : item) },
        remove: (_session, id) => { items = items.filter(item => item.id !== id) }, clear: () => { items = [] }, focus: vi.fn() } }
    const controller = new ResponseController(composer, async () => {})
    const item = surface('hello 😀')
    controller.register(item)
    controller.candidate = select(item, 0, 8)
    return { controller, composer, item, add, switchSession: () => { target = 'session-2' } }
  }

  it('immediately retains an empty comment, saves only comments, and cancel never mutates the reference', async () => {
    const { controller, composer, add } = setup()
    await controller.add()
    expect(add).toHaveBeenCalledWith(expect.objectContaining({ focus: false, text: '', expectedTarget: 'session-1' }))
    const original = composer.responses!.read('session-1')[0]!
    expect(original.comment).toBe('')
    controller.dismiss()
    expect(composer.responses!.read('session-1')).toEqual([original])
    await controller.open(original, true)
    controller.save('请解释😀')
    const saved = composer.responses!.read('session-1')[0]!
    expect(saved).toEqual({ ...original, comment: '请解释😀' })
    expect(composer.responses!.focus).toHaveBeenCalledWith('session-1')
    await controller.open(saved, true)
    controller.dismiss(true)
    expect(composer.responses!.read('session-1')).toEqual([saved])
    await controller.open(saved, true)
    controller.remove()
    expect(composer.responses!.read('session-1')).toEqual([])
  })

  it('retains snapshots on source changes, allows comment edits, and reports source unavailable', async () => {
    const { controller, composer, item } = setup()
    await controller.add()
    const snapshot = composer.responses!.read('session-1')[0]!
    controller.dismiss()
    item.root.textContent = 'different'
    await expect(controller.open(snapshot, false)).rejects.toMatchObject({ key: 'error.responseUnavailable' })
    await controller.open(snapshot, true)
    expect(controller.failure).toMatchObject({ key: 'error.responseUnavailable' })
    controller.save('still editable')
    expect(composer.responses!.read('session-1')[0]).toEqual({ ...snapshot, comment: 'still editable' })
  })

  it('rejects stale selections and does not open an editor in a different session after an async add', async () => {
    const first = setup()
    first.item.root.textContent = 'changed'
    await first.controller.add()
    expect(first.add).not.toHaveBeenCalled()
    expect(first.controller.failure).toMatchObject({ key: 'error.responseChanged' })
    const next = setup()
    next.add.mockImplementationOnce(async () => { next.switchSession() })
    await next.controller.add()
    expect(next.controller.editor).toBeUndefined()
    await expect(next.controller.open({ ...select(next.item, 0, 8).snapshot, anchors: [{ blockIndex: 0, start: 0, end: 8, text: 'hello 😀', prefixHash: prefixHash('hello 😀') }] }, true)).rejects.toMatchObject({ key: 'error.sessionChangedAdd' })
  })
})
