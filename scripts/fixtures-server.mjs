import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, resolve, relative, extname } from 'node:path'
const root = fileURLToPath(new URL('../examples/fixtures/', import.meta.url))
createServer((request, response) => {
  try {
    const path = resolve(root, '.' + decodeURIComponent(new URL(request.url, 'http://127.0.0.1:4180').pathname === '/' ? '/website.html' : new URL(request.url, 'http://127.0.0.1:4180').pathname))
    if (relative(root, path).startsWith('..')) throw new Error('outside')
    const mime = { '.html':'text/html; charset=utf-8','.pdf':'application/pdf','.md':'text/plain; charset=utf-8','.csv':'text/csv; charset=utf-8' }
    response.writeHead(200, { 'content-type': mime[extname(path)] ?? 'application/octet-stream' }); response.end(readFileSync(path))
  } catch { response.writeHead(404); response.end('Not found') }
}).listen(4180, '127.0.0.1', () => console.log(`Synthetic fixtures: http://127.0.0.1:4180/ (${root})`))
