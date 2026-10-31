import { afterEach, describe, expect, it } from 'vitest'
import { readPageText, pageRegion } from '../src/client/files/pages/selection.ts'
import { decodeFileReference, fileReference, readSentFile, serializeFileReference } from '../src/client/files/references.ts'
import type { PageSnapshot } from '../src/client/files/pages/snapshot.ts'

afterEach(() => { document.body.replaceChildren() })
const snapshot: PageSnapshot = { version: 2, id: 'page-test', address: 'dsh-resource://file/absolute/D:/slides.pptx', kind: 'office',
  text: 'Selected slide text', startPage: 2, endPage: 2 }

describe('PDF and Office selections', () => {
  it('keeps page boundaries when a real DOM range crosses PDF text layers', () => {
    document.body.innerHTML = '<main><div data-pdf-page="2"><canvas aria-label="unselected"/><div data-pdf-text><span>first page</span></div></div><div data-pdf-page="3"><div data-pdf-text><span>next page</span></div></div></main><aside>outside</aside>'
    const preview = document.querySelector('main')!
    const spans = preview.querySelectorAll('span')
    const range = document.createRange()
    range.setStart(spans[0]!.firstChild!, 6); range.setEnd(spans[1]!.firstChild!, 4)
    expect(readPageText(range, preview)).toEqual({ startPage: 2, endPage: 3, text: '[Page 2]\npage\n\n[Page 3]\nnext' })
    range.setEnd(document.querySelector('aside')!.firstChild!, 3)
    expect(readPageText(range, preview)).toBeUndefined()
  })
  it('round trips PDF/Office text and region metadata without assuming line numbers or embedding pixels', () => {
    for (const item of [snapshot, { ...snapshot, kind: 'pdf' as const, text: '', region: { x: .1, y: .2, width: .3, height: .4 },
      image: { key: snapshot.id, name: `aione-page-${snapshot.id}.png`, width: 300, height: 200 } }]) {
      const reference = fileReference(item)
      expect(reference.clipboardText).toBe('[slides.pptx:p.2]')
      expect(decodeFileReference(reference.ref)).toEqual(item)
      const sent = serializeFileReference(reference.ref, new AbortController().signal)
      expect(readSentFile({ type: 'text', ...sent })).toEqual(item)
      expect(sent.text).not.toContain('Lundefined')
      if (item.image) expect(sent.text).toContain(item.image.name)
    }
  })
  it('rejects incomplete, malformed and future page snapshots', () => {
    const image = { key: snapshot.id, name: `aione-page-${snapshot.id}.png`, width: 200, height: 200 }
    for (const value of [{ ...snapshot, version: 3 }, { ...snapshot, startPage: 0 }, { ...snapshot, text: '' },
      { ...snapshot, image }, { ...snapshot, image, region: { x: .9, y: 0, width: .4, height: 1 } },
      { ...snapshot, image: { ...image, name: 'arbitrary.png' }, region: { x: 0, y: 0, width: 1, height: 1 } }]) {
      expect(decodeFileReference(JSON.stringify(value))).toBeUndefined()
    }
  })
  it('clips backwards region drags to their starting page and rejects clicks', () => {
    const bounds = new DOMRect(100, 200, 400, 600)
    expect(pageRegion({ x: 400, y: 650 }, { x: 0, y: 0 }, bounds)).toEqual({ x: 0, y: 0, width: .75, height: .75 })
    expect(pageRegion({ x: 150, y: 250 }, { x: 151, y: 251 }, bounds)).toBeUndefined()
  })
})
