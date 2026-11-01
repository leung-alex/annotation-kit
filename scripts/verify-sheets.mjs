/** Exercise the real FortuneSheet runtime without a DSH/Aione installation. */
import { chromium, expect } from '@playwright/test'
import { createServer } from 'vite'
import { fileURLToPath } from 'node:url'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const root = fileURLToPath(new URL('../tests/browser/sheets/', import.meta.url))
const surfaceSource = process.env.ANNOTATION_SHEET_SURFACE_SOURCE
const packed = process.env.ANNOTATION_SHEET_PACKAGE && resolve(process.env.ANNOTATION_SHEET_PACKAGE)
const filter = process.env.ANNOTATION_SHEET_CHECK && new RegExp(process.env.ANNOTATION_SHEET_CHECK)
if (surfaceSource && packed) throw new Error('Choose an alternate source or a packed package, not both')
const server = await createServer({ configFile: false, root, server: { host: '127.0.0.1', port: 0,
  fs: packed ? { allow: [fileURLToPath(new URL('../', import.meta.url)), packed] } : undefined }, resolve: { dedupe: ['react', 'react-dom'] },
  plugins: [{ name: 'sheet-surface-comparison', enforce: 'pre', resolveId(id) {
    if (packed && id === '../../../src/client/files/sheets/SheetSurface.tsx') return `${packed.replaceAll('\\', '/')}/dist/react.js`
  }, load(id) {
    if (surfaceSource && id.endsWith('/src/client/files/sheets/SheetSurface.tsx')) return readFile(surfaceSource, 'utf8')
  }, transform(code, id) {
    if (packed && id === `${root.replaceAll('\\', '/')}main.tsx`) return `import ${JSON.stringify(`/@fs/${packed.replaceAll('\\', '/')}/dist/annotation-kit.css`)};\n${code}`
  } }],
  optimizeDeps: { force: true, include: ['react', 'react-dom/client', 'react/jsx-dev-runtime', '@fortune-sheet/react'], esbuildOptions: { plugins: [{ name: 'fortune-readonly-guard', setup(build) {
    build.onLoad({ filter: /@fortune-sheet[\\/]react[\\/]dist[\\/]index\.esm\.js$/ }, async ({ path }) => {
      // Mirror the host's read-only crash guard, without touching installed files or
      // selection handling. Upstream 1.0.4 otherwise loops in InputBox's layout effect.
      const code = await readFile(path, 'utf8')
      const before = 'useLayoutEffect(function () {\n    if (!context.allowEdit) {'
      expect(code.split(before)).toHaveLength(2)
      return { contents: code.replace(before, 'useLayoutEffect(function () {\n    if (!context.allowEdit && context.forceFormulaRef) {'), loader: 'js', resolveDir: dirname(path) }
    })
  } }] } },
})
await server.listen()
const browser = await chromium.launch({ channel: process.env.ANNOTATION_SHEET_BROWSER || (process.platform === 'win32' ? 'msedge' : undefined), headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
await page.addInitScript(() => {
  // Hold React Scheduler's MessageChannel work only during a quick gesture.
  // This reproduces the real ordering: pointerup's RAF runs before the pending
  // mousemove render. No selection API, event payload or library code is mocked.
  const NativeMessageChannel = window.MessageChannel
  window.sheetScheduler = { hold: false, pending: [], listeners: 0 }
  window.MessageChannel = class extends NativeMessageChannel {
    constructor() {
      super()
      const post = this.port2.postMessage.bind(this.port2)
      this.port2.postMessage = (...args) => {
        if (window.sheetScheduler.hold) window.sheetScheduler.pending.push(() => post(...args))
        else post(...args)
      }
      const port = this.port1
      const descriptor = Object.getOwnPropertyDescriptor(MessagePort.prototype, 'onmessage')
      let handler
      Object.defineProperty(port, 'onmessage', { get: () => handler, set: next => {
        handler = next
        if (typeof next !== 'function') { descriptor.set.call(port, next); return }
        window.sheetScheduler.listeners++
        descriptor.set.call(port, event => {
          if (window.sheetScheduler.hold) window.sheetScheduler.pending.push(() => next.call(port, event))
          else next.call(port, event)
        })
      } })
    }
  }
})
const errors = []
page.on('pageerror', error => errors.push(error.message))
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
const url = server.resolvedUrls.local[0]
const results = []
const evidence = process.env.ANNOTATION_SHEET_EVIDENCE && resolve(process.env.ANNOTATION_SHEET_EVIDENCE)
if (evidence) await mkdir(evidence, { recursive: true })
const textarea = page.locator('[data-page-comment] textarea')
const expectedCells = ['RC5-001', 'First', 12, 'Ready', 'RC5-002', 'Second', 24, 'Review']

async function fresh() {
  if (page.url().startsWith(url)) await page.evaluate(() => localStorage.clear())
  await page.goto(url, { waitUntil: 'networkidle' })
  await expect(page).toHaveTitle('Sheet selection regression')
  await expect(page.locator('h1')).toHaveText('CSV selection regression')
  await expect(page.locator('.fortune-name-box')).toHaveText('A1')
  await expect(page.locator('vite-error-overlay')).toHaveCount(0)
}

async function replay({ single = false, shortcut = false, cancel, supersede = false } = {}) {
  const guarded = await page.locator('.fortune-cell-area').evaluate(async (el, options) => {
    window.sheetScheduler.hold = true
    const b = el.getBoundingClientRect()
    const send = (type, x, y, buttons) => el.dispatchEvent(type.startsWith('pointer')
      ? new PointerEvent(type, { bubbles: true, clientX: b.x + x, clientY: b.y + y, pointerId: 1, pointerType: 'mouse', button: 0, buttons })
      : new MouseEvent(type, { bubbles: true, clientX: b.x + x, clientY: b.y + y, button: 0, buttons }))
    const drag = (start, end) => {
      send('pointerdown', ...start, 1); send('mousedown', ...start, 1)
      send('pointermove', ...end, 1); send('mousemove', ...end, 1)
      send('pointerup', ...end, 0); send('mouseup', ...end, 0)
    }
    // The captured failing order, entirely in one JS task. No wait before pointerup.
    drag([37, 30], options.single ? [37, 30] : [259, 50])
    if (options.supersede) drag([110, 70], [110, 70])
    const host = document.querySelector('.workbook')
    host.focus()
    if (options.shortcut) host.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'x', ctrlKey: true, shiftKey: true }))
    if (options.cancel === 'escape') host.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }))
    if (options.cancel === 'pointercancel') el.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 1 }))
    if (options.cancel === 'outside') document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }))
    if (options.cancel === 'session') window.sheetTest.changeSession()
    if (options.cancel === 'unmount') window.sheetTest.unmount()
    await new Promise(requestAnimationFrame)
    window.sheetScheduler.hold = false
    const work = window.sheetScheduler.pending.splice(0)
    for (const run of work) run()
    return window.sheetScheduler.listeners
  }, { single, shortcut, cancel, supersede })
  expect(guarded, 'The race must run with React Scheduler guarded past pointerup RAF').toBeGreaterThan(0)
}

async function open(entry, { single = false, native = false, supersede = false } = {}) {
  if (entry === 'request') await page.locator('[data-sheet-request-edits]').click()
  if (native) {
    const b = await page.locator('.fortune-cell-area').boundingBox()
    await page.mouse.move(b.x + 37, b.y + 30)
    await page.mouse.down()
    await page.mouse.move(b.x + (single ? 37 : 259), b.y + (single ? 30 : 50), { steps: 10 })
    await page.mouse.up()
    if (entry === 'shortcut') await page.keyboard.press('Control+Shift+X')
  } else await replay({ single, shortcut: entry === 'shortcut', supersede })
  if (entry === 'floating') await page.locator('[data-sheet-ask]').click()
  await expect(textarea).toBeVisible()
  const range = supersede ? 'B4' : single ? 'A2' : 'A2:D3'
  await expect(page.locator('.fortune-name-box')).toHaveText(range)
  await expect(page.locator('[data-sheet-range]')).toHaveAttribute('data-sheet-range', range)
}

async function saved() {
  return page.evaluate(() => JSON.parse(localStorage.getItem('annotation-kit.document-annotations.v1:sheet-regression:memory://test/selection.csv') ?? '[]'))
}

async function save(expected = expectedCells, a1 = 'A2:D3') {
  await textarea.fill('Keep the original selection')
  await page.locator('[data-page-comment]').getByRole('button', { name: 'Comment', exact: true }).click()
  await expect(textarea).toHaveCount(0)
  const items = await saved()
  expect(items).toHaveLength(1)
  expect(items[0].a1).toBe(a1)
  expect(items[0].cells.map(cell => cell.raw)).toEqual(expected)
  expect(items[0].cells.map(cell => [cell.row, cell.column])).toEqual(a1 === 'A2:D3'
    ? [[1, 0], [1, 1], [1, 2], [1, 3], [2, 0], [2, 1], [2, 2], [2, 3]] : a1 === 'B4' ? [[3, 1]] : [[1, 0]])
}

async function check(name, run) {
  if (filter && !filter.test(name)) return
  try { await run(); results.push({ name, pass: true }) }
  catch (error) {
    results.push({ name, pass: false, error: error.message })
    console.error(`FAIL: ${name}\n${error.message}`)
    if (evidence) await page.screenshot({ path: `${evidence}/failure-${results.length}.png` })
  }
}

try {
  for (const entry of ['request', 'floating', 'shortcut']) {
    for (let i = 0; i < (entry === 'request' ? 12 : 4); i++) await check(`quick ${entry} ${i + 1}`, async () => {
      await fresh(); await open(entry); await save()
    })
    await check(`single cell ${entry}`, async () => { await fresh(); await open(entry, { single: true }); await save(['RC5-001'], 'A2') })
    await check(`native drag ${entry}`, async () => { await fresh(); await open(entry, { native: true }); await save() })
  }

  await check('immutable snapshot and restored annotation', async () => {
    await fresh(); await open('request')
    await page.evaluate(() => { window.sheetTest.select([{ row: [3, 3], column: [1, 1] }]); window.sheetTest.changeCell() })
    await expect(page.locator('.fortune-name-box')).toHaveText('B4')
    expect(await page.evaluate(() => window.sheetTest.cellValue())).toBe('CHANGED')
    await expect(page.locator('[data-sheet-range]')).toHaveAttribute('data-sheet-range', 'A2:D3')
    if (evidence) await page.screenshot({ path: `${evidence}/immutable-selection.png` })
    await save()
    await page.reload({ waitUntil: 'networkidle' })
    await page.getByRole('button', { name: 'Edit annotation 1', exact: true }).click()
    await expect(textarea).toHaveValue('Keep the original selection')
    await expect(page.locator('[data-sheet-range]')).toHaveAttribute('data-sheet-range', 'A2:D3')
    await textarea.fill('Restored all eight original cells')
    await page.locator('[data-page-comment]').getByRole('button', { name: 'Save', exact: true }).click()
    await expect(textarea).toHaveCount(0)
    const items = await saved()
    expect(items[0].cells.map(cell => cell.raw)).toEqual(expectedCells)
    await page.getByRole('button', { name: '1 annotation', exact: true }).click()
    await expect(page.locator('[data-sheet-annotations] tr')).toHaveCount(9)
    await expect(page.locator('[data-sheet-annotations]')).toContainText('RC5-002')
    if (evidence) await page.screenshot({ path: `${evidence}/restored-eight-cells.png` })
  })

  await check('new gesture supersedes pending capture', async () => {
    await fresh(); await open('request', { supersede: true }); await save(['Third'], 'B4')
  })

  for (const cancel of ['escape', 'pointercancel', 'outside', 'session', 'unmount']) await check(`cancel pending capture: ${cancel}`, async () => {
    await fresh(); await page.locator('[data-sheet-request-edits]').click(); await replay({ cancel })
    // Let rendering and the browser task queue drain before checking absence.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestIdleCallback(resolve))))
    await expect(textarea).toHaveCount(0)
    await expect(page.locator('[data-sheet-ask]')).toHaveCount(0)
  })

  const report = { browser: await browser.version(), url, viewport: page.viewportSize(), surfaceSource: surfaceSource ?? packed ?? 'working tree', results, errors }
  if (evidence) await writeFile(`${evidence}/results.json`, JSON.stringify(report, null, 2) + '\n')
  console.log(JSON.stringify({ checks: results.length, passed: results.filter(result => result.pass).length, failures: results.filter(result => !result.pass), errors, evidence }, null, 2))
  if (results.some(result => !result.pass)) throw new Error(`${results.filter(result => !result.pass).length} sheet regression checks failed`)
  expect(errors).toEqual([])
} catch (error) {
  console.error(JSON.stringify({ url: page.url(), errors, body: await page.locator('body').innerText() }, null, 2))
  throw error
} finally { await browser.close(); await server.close() }
