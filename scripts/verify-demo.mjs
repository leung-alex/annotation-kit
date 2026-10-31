/** Real browser interaction and fresh README screenshots. Browser plugin is unavailable here. */
import { chromium } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'

const directory = fileURLToPath(new URL('../docs/screenshots/', import.meta.url))
await mkdir(directory, { recursive: true })
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 })
const errors = []
page.on('pageerror', error => errors.push(error.message))
try {
  await page.goto('http://127.0.0.1:4178/', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Annotate', exact: true }).click()
  await page.locator('#start-project').click()
  await page.locator('[data-aione-annotation-comment] textarea').fill('Make this action clearer: start with a project template.')
  await page.screenshot({ path: `${directory}/web-react.png`, fullPage: true })
  await page.locator('[data-aione-annotation-comment]').evaluate(form => form.requestSubmit())
  await page.locator('.web-draft img').waitFor()
  await page.getByRole('button', { name: 'Text / Markdown', exact: true }).click()
  const text = page.locator('[data-textpreview-line="6"] span:last-child')
  await selectText(text)
  await page.locator('[data-annotation-file-add]').click()
  await page.locator('.draft [data-file-selection-card]').first().waitFor()
  await page.screenshot({ path: `${directory}/text-react.png`, fullPage: true })
  await page.getByRole('button', { name: 'Assistant reply', exact: true }).click()
  await selectText(page.locator('[data-response-source] p').nth(1))
  await page.locator('[data-response-add]').click()
  await page.locator('.draft [data-response-annotation-card]').waitFor()
  await page.screenshot({ path: `${directory}/assistant-react.png`, fullPage: true })
  await page.getByRole('button', { name: 'Send draft', exact: false }).click()
  await page.locator('[data-annotation-message]').waitFor()
  await page.getByRole('button', { name: /annotations.*Expand/i }).click().catch(async () => { await page.locator('[data-annotation-message] button').first().click() })
  await page.screenshot({ path: `${directory}/sent-react.png`, fullPage: true })
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Sent cards', exact: true }).click()
  assert.equal(await page.locator('[data-annotation-message]').count(), 1)
  assert.deepEqual(errors, [])
  await writeFile(`${directory}/react-environment.json`, JSON.stringify({ date: new Date().toISOString(), os: process.platform, browser: await browser.version(), react: '18.3.1', capture: 'Playwright screenshot of the running example; browser host image uses html2canvas', checks: ['element selection','PNG handoff','text selection','assistant selection','serialization','sent card','reload recovery'], errors }, null, 2) + '\n')
  console.log('React example interaction, persistence and screenshots PASS')
} finally { await browser.close() }

async function selectText(locator) {
  const rect = await locator.boundingBox()
  assert(rect)
  await page.mouse.move(rect.x + 1, rect.y + rect.height / 2)
  await page.mouse.down()
  await page.mouse.move(rect.x + Math.min(rect.width - 1, 390), rect.y + rect.height / 2, { steps: 18 })
  await page.mouse.up()
}
