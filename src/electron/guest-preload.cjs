/* Sandboxed webview preload. Only the owning Desktop main process can command it. */
'use strict'

const { ipcRenderer } = require('electron')
const COMMAND = 'aione-desktop:annotation-guest-command'
const SELECTION = 'aione-desktop:annotation-guest-selection'
const PAINTED = 'aione-desktop:annotation-guest-painted'
const reactGrabPrimitives = /* AIONE_REACT_GRAB_PRIMITIVES */ null
const { elementContext } = /* AIONE_ELEMENT_CONTEXT */ null

let mode = 'off'
let epoch = ''
let host
let layer
let shield
let dragStart
let preview
let currentTarget
let currentSelection
let dragCompleted = false
let frameStyle
const markers = new Map()

function rectOf(rect) {
  const x = Math.max(0, rect.x)
  const y = Math.max(0, rect.y)
  const right = Math.min(window.innerWidth, rect.x + rect.width)
  const bottom = Math.min(window.innerHeight, rect.y + rect.height)
  return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) }
}

function cssSelector(element) {
  const parts = []
  let node = element
  while (node && node.nodeType === Node.ELEMENT_NODE && parts.length < 12) {
    const tag = node.tagName.toLowerCase()
    if (node.id) {
      parts.unshift(`${tag}#${CSS.escape(node.id)}`)
      const root = node.getRootNode()
      if (root instanceof ShadowRoot) {
        parts.unshift('>>>')
        node = root.host
        continue
      }
      break
    }
    let index = 1
    for (let previous = node.previousElementSibling; previous; previous = previous.previousElementSibling) {
      if (previous.tagName === node.tagName) index++
    }
    parts.unshift(`${tag}:nth-of-type(${index})`)
    const root = node.getRootNode()
    if (node.parentElement) node = node.parentElement
    else if (root instanceof ShadowRoot) {
      parts.unshift('>>>')
      node = root.host
    } else break
  }
  return parts.join(' > ').replaceAll(' > >>> > ', ' >>> ').slice(0, 2048)
}

function elementAt(x, y) {
  shield.style.pointerEvents = 'none'
  if (frameStyle?.sheet) frameStyle.sheet.disabled = true
  let element = document.elementFromPoint(x, y)
  try {
    const grabbed = reactGrabPrimitives?.getElementAtPoint(x, y)
    if (grabbed && grabbed.ownerDocument === document && grabbed !== host) element = grabbed
  } catch { /* Sites with unusual DOMs still use native hit testing. */ }
  shield.style.pointerEvents = 'auto'
  if (frameStyle?.sheet) frameStyle.sheet.disabled = false
  let offsetX = 0
  let offsetY = 0
  const frames = []
  for (let depth = 0; depth < 8 && element; depth++) {
    if (element.shadowRoot) {
      const nested = element.shadowRoot.elementFromPoint(x - offsetX, y - offsetY)
      if (nested && nested !== element) { element = nested; continue }
    }
    if (element.tagName === 'IFRAME') {
      let frameDocument
      const frameRect = element.getBoundingClientRect()
      const transformed = getComputedStyle(element).transform !== 'none'
        || Math.abs(frameRect.width - element.offsetWidth) > 1
        || Math.abs(frameRect.height - element.offsetHeight) > 1
      try { frameDocument = element.contentDocument } catch { /* Cross-origin frame: select its region. */ }
      if (frameDocument && !transformed) {
        const nested = frameDocument.elementFromPoint(
          x - offsetX - frameRect.x - element.clientLeft,
          y - offsetY - frameRect.y - element.clientTop)
        if (nested) {
          frames.push(cssSelector(element))
          offsetX += frameRect.x + element.clientLeft
          offsetY += frameRect.y + element.clientTop
          element = nested
          continue
        }
      }
    }
    break
  }
  if (!element || element === host || element === document.documentElement) return undefined
  const bounds = element.getBoundingClientRect()
  const rect = rectOf({ x: bounds.x + offsetX, y: bounds.y + offsetY, width: bounds.width, height: bounds.height })
  if (rect.width < 1 || rect.height < 1) return undefined
  let selectedSelector = cssSelector(element)
  try {
    if (!(element.getRootNode() instanceof ShadowRoot)) {
      selectedSelector = reactGrabPrimitives?.getElementSelector(element) || selectedSelector
    }
  } catch { /* Native selector remains usable. */ }
  return { element, selector: [...frames, selectedSelector].join(' >> ').slice(0, 2048), rect,
    frame: frames.length ? frames.join(' >> ') : 'top document' }
}

function selection(kind, rect, details = {}) {
  return {
    kind, rect, viewport: { width: window.innerWidth, height: window.innerHeight },
    scroll: { x: window.scrollX, y: window.scrollY },
    url: location.href, title: document.title.slice(0, 2048), ...details,
  }
}

function emitSelection(value) {
  currentSelection = value
  ipcRenderer.send(SELECTION, { epoch, selection: value })
}

function drawBox(box, number) {
  const outline = document.createElement('div')
  outline.style.cssText = 'position:absolute;box-sizing:border-box;border:2px solid #1677ff;background:rgba(22,119,255,.07);pointer-events:none;'
  outline.style.left = `${box.x}px`
  outline.style.top = `${box.y}px`
  outline.style.width = `${box.width}px`
  outline.style.height = `${box.height}px`
  if (number !== undefined) {
    const badge = document.createElement('span')
    badge.textContent = String(number)
    badge.style.cssText = 'position:absolute;left:0;top:0;padding:1px 6px;border-radius:0 0 4px 0;background:#1677ff;color:#fff;font:700 12px/18px system-ui;'
    outline.append(badge)
  }
  layer.append(outline)
  return outline
}

function showPreview(rect) {
  preview?.remove()
  preview = rect && rect.width > 0 && rect.height > 0 ? drawBox(rect) : undefined
}

function targetRect(element) {
  if (!element?.isConnected) return undefined
  const bounds = element.getBoundingClientRect()
  let x = bounds.x
  let y = bounds.y
  let frame = element.ownerDocument.defaultView?.frameElement
  for (let depth = 0; frame && depth < 8; depth++) {
    const parent = frame.getBoundingClientRect()
    if (getComputedStyle(frame).transform !== 'none'
      || Math.abs(parent.width - frame.offsetWidth) > 1
      || Math.abs(parent.height - frame.offsetHeight) > 1) return undefined
    x += parent.x + frame.clientLeft
    y += parent.y + frame.clientTop
    frame = frame.ownerDocument.defaultView?.frameElement
  }
  return rectOf({ x, y, width: bounds.width, height: bounds.height })
}

function stillCurrent(request) {
  const selected = request.selection
  if (!currentSelection || JSON.stringify(selected) !== JSON.stringify(currentSelection)
    || selected.url !== location.href
    || selected.viewport.width !== window.innerWidth || selected.viewport.height !== window.innerHeight
    || selected.scroll.x !== window.scrollX || selected.scroll.y !== window.scrollY) return false
  if (selected.kind === 'region' && !currentTarget) return true
  const now = targetRect(currentTarget)
  if (selected.element && JSON.stringify(elementContext(currentTarget, selected.element.frame)) !== JSON.stringify(selected.element)) return false
  return now && ['x', 'y', 'width', 'height'].every(key => Math.abs(now[key] - selected.rect[key]) <= 1)
}

function ensureLayer() {
  if (host?.isConnected) return
  host = document.createElement('div')
  host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;contain:layout style paint;'
  const root = host.attachShadow({ mode: 'closed' })
  layer = document.createElement('div')
  layer.style.cssText = 'position:absolute;inset:0;pointer-events:none;'
  shield = document.createElement('div')
  shield.style.cssText = 'position:absolute;inset:0;pointer-events:none;cursor:crosshair;touch-action:none;'
  root.append(layer, shield)
  document.documentElement.append(host)
  const clearOnViewportChange = () => {
    markers.clear()
    layer.replaceChildren()
    preview = undefined
    dragStart = undefined
    currentTarget = undefined
    currentSelection = undefined
    if (mode !== 'off') ipcRenderer.send(SELECTION, { epoch, selection: null })
  }
  window.addEventListener('scroll', clearOnViewportChange, true)
  let viewportWidth = window.innerWidth, viewportHeight = window.innerHeight
  window.addEventListener('resize', () => {
    // Electron capturePage can emit resize without changing the viewport.
    // Invalidating that notification would cancel the capture it belongs to.
    if (viewportWidth === window.innerWidth && viewportHeight === window.innerHeight) return
    viewportWidth = window.innerWidth
    viewportHeight = window.innerHeight
    clearOnViewportChange()
  })
  window.addEventListener('keydown', event => {
    if (mode === 'off' || !event.isTrusted || event.isComposing || event.key !== 'Escape') return
    event.preventDefault()
    event.stopImmediatePropagation()
    ipcRenderer.send(SELECTION, { epoch, escape: true })
  }, true)
  shield.addEventListener('pointermove', event => {
    if (!event.isTrusted) return
    if (mode === 'element' && !dragStart && !currentSelection) showPreview(elementAt(event.clientX, event.clientY)?.rect)
    if (dragStart && (mode === 'region' || Math.hypot(event.clientX - dragStart.x, event.clientY - dragStart.y) > 5)) {
      showPreview(rectOf({ x: Math.min(dragStart.x, event.clientX), y: Math.min(dragStart.y, event.clientY),
        width: Math.abs(event.clientX - dragStart.x), height: Math.abs(event.clientY - dragStart.y) }))
    }
  })
  shield.addEventListener('click', event => {
    if (mode !== 'element' || !event.isTrusted) return
    event.preventDefault()
    event.stopPropagation()
    if (dragCompleted) { dragCompleted = false; return }
    const result = elementAt(event.clientX, event.clientY)
    if (!result) return
    currentTarget = result.element
    showPreview(result.rect)
    const fallback = result.element.tagName === 'IFRAME' || result.element.tagName === 'CANVAS'
      || (result.element.tagName.includes('-') && !result.element.shadowRoot)
    if (fallback) {
      emitSelection(selection('region', result.rect, { anchor: { x: event.clientX, y: event.clientY } }))
      return
    }
    emitSelection(selection('element', result.rect, {
      selector: result.selector,
      text: (result.element.innerText ?? result.element.textContent ?? '').trim().slice(0, 2048),
      element: elementContext(result.element, result.frame),
      anchor: { x: event.clientX, y: event.clientY },
    }))
  }, true)
  shield.addEventListener('pointerdown', event => {
    if (mode === 'off' || !event.isTrusted || event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    dragStart = { x: event.clientX, y: event.clientY }
    dragCompleted = false
    shield.setPointerCapture(event.pointerId)
  }, true)
  shield.addEventListener('pointerup', event => {
    if (mode === 'off' || !dragStart || !event.isTrusted) return
    event.preventDefault()
    event.stopPropagation()
    const x = Math.min(dragStart.x, event.clientX)
    const y = Math.min(dragStart.y, event.clientY)
    const rect = rectOf({ x, y, width: Math.abs(event.clientX - dragStart.x), height: Math.abs(event.clientY - dragStart.y) })
    dragStart = undefined
    if (mode === 'element' && (rect.width < 6 || rect.height < 6)) return
    dragCompleted = true
    showPreview(rect)
    currentTarget = undefined
    if (rect.width >= 3 && rect.height >= 3) emitSelection(selection('region', rect, { anchor: { x, y } }))
  }, true)
  shield.addEventListener('pointercancel', () => { dragStart = undefined; showPreview(undefined) })
}

function setFrameInputBlocked(blocked) {
  if (!blocked) { frameStyle?.remove(); frameStyle = undefined; return }
  if (frameStyle?.isConnected) return
  frameStyle = document.createElement('style')
  frameStyle.textContent = 'iframe { pointer-events: none !important; }'
  document.head.append(frameStyle)
}

ipcRenderer.on(COMMAND, (_event, request) => {
  if (!request || typeof request !== 'object') return
  if (request.kind === 'mode' && ['off', 'element', 'region'].includes(request.mode)
    && typeof request.epoch === 'string') {
    if (epoch !== request.epoch) { markers.clear(); layer?.replaceChildren(); preview = undefined; currentTarget = undefined; currentSelection = undefined }
    epoch = request.epoch
    mode = request.mode
    currentTarget = undefined
    currentSelection = undefined
    showPreview(undefined)
    ensureLayer()
    markers.clear()
    layer.replaceChildren()
    shield.style.pointerEvents = mode === 'off' ? 'none' : 'auto'
    setFrameInputBlocked(mode !== 'off')
    if (mode === 'off') { markers.clear(); layer.replaceChildren(); preview = undefined; currentTarget = undefined; currentSelection = undefined }
    return
  }
  if (request.kind === 'verify' && request.epoch === epoch && typeof request.requestId === 'string') {
    ipcRenderer.send(PAINTED, { requestId: request.requestId, epoch,
      ...(!stillCurrent(request) ? { error: 'selection-moved' } : {}) })
    return
  }
  if (request.kind !== 'paint' || request.epoch !== epoch
    || !Number.isSafeInteger(request.number) || request.number < 1 || request.number > 999
    || typeof request.requestId !== 'string' || !request.selection?.rect) return
  ensureLayer()
  if (!stillCurrent(request)) {
    ipcRenderer.send(PAINTED, { requestId: request.requestId, epoch, error: 'selection-moved' })
    return
  }
  showPreview(undefined)
  markers.get(request.number)?.remove()
  markers.set(request.number, drawBox(request.selection.rect, request.number))
  let acknowledged = false
  const acknowledge = () => {
    if (acknowledged) return
    acknowledged = true
    clearTimeout(fallback)
    if (request.epoch !== epoch || !host.isConnected) return
    ipcRenderer.send(PAINTED, { requestId: request.requestId, epoch,
      ...(!stillCurrent(request) ? { error: 'selection-moved' } : {}) })
  }
  // Chromium can suspend both animation frames while the Desktop window is occluded.
  // A delayed timer still lets capturePage force a composite of the new marker.
  const fallback = setTimeout(acknowledge, 100)
  requestAnimationFrame(() => requestAnimationFrame(acknowledge))
})
