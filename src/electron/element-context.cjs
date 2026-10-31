/* Pure DOM projection, bundled into the sandboxed guest and shared with DOM tests. */
'use strict'

const attributeNames = ['id', 'name', 'type', 'placeholder', 'aria-label', 'aria-labelledby', 'aria-describedby', 'title', 'alt', 'href']
const bounded = value => String(value ?? '').trim().slice(0, 1024)

function roleOf(element) {
  const explicit = element.getAttribute('role')
  if (explicit) return bounded(explicit)
  const tag = element.tagName.toLowerCase()
  if (tag === 'textarea') return 'textbox'
  if (tag === 'select') return element.multiple ? 'listbox' : 'combobox'
  if (tag === 'button') return 'button'
  if (tag === 'a' && element.hasAttribute('href')) return 'link'
  if (tag === 'img') return 'img'
  if (tag !== 'input') return undefined
  const type = element.type.toLowerCase()
  if (['button', 'submit', 'reset', 'image'].includes(type)) return 'button'
  if (['checkbox', 'radio'].includes(type)) return type
  if (type === 'number') return 'spinbutton'
  if (type === 'range') return 'slider'
  if (type === 'search') return 'searchbox'
  if (['hidden', 'password', 'file', 'color', 'date', 'time'].includes(type)) return undefined
  return 'textbox'
}

function describe(element) {
  const tagName = element.tagName.toLowerCase()
  /** @type {Record<string, string>} */
  const attributes = {}
  for (const name of attributeNames) {
    if (element.hasAttribute(name)) attributes[name] = bounded(element.getAttribute(name))
  }
  // Passwords and payment/autofill secrets are never copied into text context.
  const sensitive = element.type === 'password' || element.type === 'hidden' || element.type === 'file'
    || /(?:password|one-time-code|cc-)/i.test(element.getAttribute('autocomplete') || '')
  if (!sensitive && ['input', 'textarea', 'select'].includes(tagName)) attributes.value = bounded(element.value)
  if (['checkbox', 'radio'].includes(element.type)) attributes.checked = String(element.checked)
  const labels = element.labels ? [...element.labels].map(label => bounded(label.innerText ?? label.textContent)).filter(Boolean).join(' ') : ''
  if (labels) attributes.label = bounded(labels)
  const role = roleOf(element)
  return { tagName, ...(role ? { role } : {}), attributes }
}

/**
 * @param {Element} element
 * @param {string} [frame]
 * @returns {import('../shared/desktop.ts').BrowserAnnotationElement}
 */
function elementContext(element, frame = 'top document') {
  const path = []
  let node = element
  for (let depth = 0; node && depth < 12; depth++) {
    path.unshift(node.tagName.toLowerCase())
    const parent = node.parentElement
    if (parent) node = parent
    else {
      const root = node.getRootNode()
      if (root.host) { path.unshift('shadow-root'); node = root.host }
      else break
    }
  }
  const controls = []
  for (const control of element.querySelectorAll('input, textarea, select, button, [role="textbox"], [role="combobox"]')) {
    if (controls.length === 8) break
    if (control.type === 'hidden' || control.hidden || control.getClientRects().length === 0) continue
    controls.push(describe(control))
  }
  return { ...describe(element), path: path.join(' > '), frame: bounded(frame), ...(controls.length ? { controls } : {}) }
}

module.exports = { elementContext }
