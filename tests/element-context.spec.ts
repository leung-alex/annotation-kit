import { expect, it } from 'vitest'
import { elementContext } from '../src/electron/element-context.cjs'

it('captures the placeholder and accessible name of an input whose visible text is empty', () => {
  document.body.innerHTML = '<main><form role="search"><input id="q" placeholder="Search the web" aria-label="Search" value="weather"></form></main>'
  const input = document.getElementById('q')!
  expect(input.textContent).toBe('')
  expect(elementContext(input, 'top document')).toMatchObject({
    tagName: 'input', role: 'textbox', frame: 'top document', path: 'html > body > main > form > input',
    attributes: { placeholder: 'Search the web', 'aria-label': 'Search', value: 'weather' },
  })
})

it('includes visible form controls when a container is selected and excludes password values', () => {
  document.body.innerHTML = '<form><input placeholder="Search the web"><input type="password" value="private"></form>'
  for (const input of document.querySelectorAll('input')) {
    input.getClientRects = () => [{ width: 100, height: 24 }] as unknown as DOMRectList
  }
  expect(elementContext(document.querySelector('form')!, 'top document').controls?.[0]?.attributes.placeholder).toBe('Search the web')
  expect(JSON.stringify(elementContext(document.querySelector('form')!, 'top document'))).not.toContain('private')
  expect(elementContext(document.querySelector('[type=password]')!, 'top document').attributes).not.toHaveProperty('value')
})
