import { describe, expect, it } from 'vitest'
import { readFileSelection } from '../src/client/files/selection.ts'

function between(start: Text, startOffset: number, end: Text, endOffset: number): Range {
  const range = document.createRange()
  range.setStart(start, startOffset)
  range.setEnd(end, endOffset)
  return range
}

describe('file preview selection', () => {
  it('maps highlighted code selection to source lines and UTF-16 columns', () => {
    const root = document.createElement('div')
    root.innerHTML = '<pre><code><span>alpha\n</span><span>中😀beta\n</span></code></pre>'
    const parts = root.querySelectorAll('code span')
    const start = parts[0]?.firstChild as Text
    const end = parts[1]?.firstChild as Text
    expect(readFileSelection(between(start, 3, end, 3), root, 'code')).toEqual({
      text: 'ha\n中😀', startLine: 1, endLine: 2, startColumn: 4, endColumn: 4,
    })
  })

  it('counts CRLF as one source line break', () => {
    const root = document.createElement('div')
    root.innerHTML = '<pre><code></code></pre>'
    const code = root.querySelector('code') as HTMLElement
    code.textContent = 'one\r\ntwo\r\n三'
    const text = code.firstChild as Text
    expect(readFileSelection(between(text, 3, text, 10), root, 'code')).toEqual({
      text: '\r\ntwo\r\n', startLine: 1, endLine: 3, startColumn: 4, endColumn: 1,
    })
  })

  it('uses loaded page line numbers and rejects a selection crossing the preview boundary', () => {
    const root = document.createElement('div')
    root.innerHTML = '<pre data-textpreview-plain><div data-textpreview-line="41">first\n</div><div data-textpreview-line="42">second\n</div></pre>'
    const lines = root.querySelectorAll('[data-textpreview-line]')
    const start = lines[0]?.firstChild as Text
    const end = lines[1]?.firstChild as Text
    expect(readFileSelection(between(start, 2, end, 4), root, 'text')).toEqual({
      text: 'rst\nseco', startLine: 41, endLine: 42,
    })
    const outside = document.createTextNode('outside')
    document.body.append(outside)
    expect(readFileSelection(between(start, 2, outside, 3), root, 'text')).toBeUndefined()
    outside.remove()
  })

  it('reports enclosing Markdown source blocks rather than invented character positions', () => {
    const root = document.createElement('div')
    root.innerHTML = '<p data-annotation-source-start-line="5" data-annotation-source-end-line="8">first</p>'
      + '<ul data-annotation-source-start-line="9" data-annotation-source-end-line="13"><li>second</li></ul>'
    const start = root.querySelector('p')?.firstChild as Text
    const end = root.querySelector('li')?.firstChild as Text
    expect(readFileSelection(between(start, 2, end, 3), root, 'markdown')).toEqual({
      text: 'rstsec', startLine: 5, endLine: 13,
    })
  })
})
