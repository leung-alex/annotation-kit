import { expect, it } from 'vitest'
import { bindReferencePresentation } from '../src/client/composer/reference-presentation.ts'

it('groups late-restored chips, preserves unrelated references, and releases DOM ownership', async () => {
  const card = document.createElement('div')
  const release = bindReferencePresentation(card, {
    draft: '[saved] ',
    occurrences: [{ source: 'file', ref: 'snapshot', offset: 0, length: 7, label: 'saved' }],
  }, (source, ref) => source === 'file' && ref === 'snapshot')
  card.innerHTML = '<div contenteditable="true"><span data-composer-chip="other">Other</span><span data-composer-chip="file">Saved</span></div>'
  await Promise.resolve()
  expect(card.querySelector('[data-composer-chip="file"]')?.hasAttribute('data-aione-annotation-owned')).toBe(true)
  expect(card.querySelector('[data-composer-chip="other"]')?.hasAttribute('data-aione-annotation-owned')).toBe(false)
  expect(card.querySelector('[contenteditable]')?.hasAttribute('data-aione-annotation-only')).toBe(true)
  release()
  expect(card.querySelector('[data-aione-annotation-owned]')).toBeNull()
  expect(card.querySelector('[data-aione-annotation-only]')).toBeNull()
  card.append(document.createElement('span'))
  await Promise.resolve()
  expect(card.querySelector('[data-aione-annotation-owned]')).toBeNull()
})
