/** Verify the packed package from a consumer outside the source repository. */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
const root = fileURLToPath(new URL('../', import.meta.url))
const manager = process.env.npm_execpath
if (!manager) throw new Error('Run pnpm verify or pnpm check:package')
function run(args, cwd) {
  const result = spawnSync(process.execPath, [manager, ...args], { cwd, encoding: 'utf8', windowsHide: true })
  if (result.status !== 0) throw new Error(`${args.join(' ')} failed:\n${result.stdout}\n${result.stderr}`)
  return result.stdout
}
mkdirSync(join(root, '.artifacts'), { recursive: true })
run(['pack', '--pack-destination', join(root, '.artifacts')], root)
const tarball = join(root, '.artifacts', 'annotation-kit-0.1.0.tgz')
const consumer = mkdtempSync(join(tmpdir(), 'annotation-kit-consumer-'))
writeFileSync(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module', scripts: { build: 'vite build', typecheck: 'tsc --noEmit' },
  dependencies: { 'annotation-kit': `file:${tarball.replaceAll('\\', '/')}`, react: '18.3.1', 'react-dom': '18.3.1' },
  devDependencies: { vite: '6.4.3', typescript: '6.0.3', '@types/react': '18.3.31', '@types/react-dom': '18.3.7' } }, null, 2))
writeFileSync(join(consumer, 'pnpm-workspace.yaml'), "packages: ['.']\nverifyDepsBeforeRun: false\nallowBuilds:\n  esbuild: true\n")
run(['install'], consumer)
writeFileSync(join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, module: 'ESNext', moduleResolution: 'Bundler', jsx: 'react-jsx', target: 'ES2022', skipLibCheck: false, noEmit: true, lib: ['ES2022', 'DOM'], types: ['vite/client'] }, include: ['main.tsx'] }))
writeFileSync(join(consumer, 'index.html'), '<div id="root"></div><script type="module" src="/main.tsx"></script>')
writeFileSync(join(consumer, 'main.tsx'), `import {createRoot} from 'react-dom/client'\nimport {en, fileReference, type TextSnapshot} from 'annotation-kit'\nimport {SelectionCard} from 'annotation-kit/react'\nimport 'annotation-kit/styles.css'\nconst snapshot:TextSnapshot={version:1,id:'x',kind:'text',address:'memory://test/a.txt',text:'Original text',startLine:1,endLine:1,startColumn:1,endColumn:14}\nfileReference(snapshot)\ncreateRoot(document.getElementById('root')!).render(<SelectionCard items={[snapshot]} t={key=>en[key]}/>)\n`)
run(['run', 'typecheck'], consumer)
run(['run', 'build'], consumer)
const nodeImport = spawnSync(process.execPath, ['--input-type=module', '-e', "const a=await import('annotation-kit');const e=await import('annotation-kit/electron');if(!a.PageBatches||!e.renderAnnotationGuestPreload().includes('annotation-kit:annotation-guest-command'))process.exit(1);console.log('import PASS')"], { cwd: consumer, encoding: 'utf8', windowsHide: true })
assert.equal(nodeImport.status, 0, nodeImport.stderr)
for (const path of ['dist/index.js', 'dist/react.js', 'dist/electron.js']) {
  const code = readFileSync(join(root, path), 'utf8')
  assert(!/ReactCurrentDispatcher|react\.development\.js|D:[/\\]project|@aione\//.test(code), `Private path or bundled React in ${path}`)
}
function checkTree(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) checkTree(path)
    else if (/\.(?:js|ts|mts|cjs|mjs)$/.test(entry.name)) assert(!/@aione\/|\.dsh-home|D:[/\\]project/.test(readFileSync(path, 'utf8')), `Private dependency in ${path}`)
  }
}
checkTree(join(root, 'dist'))
const sha512 = createHash('sha512').update(readFileSync(tarball)).digest('hex')
mkdirSync(join(root, '.logs', 'package'), { recursive: true })
writeFileSync(join(root, '.logs/package/receipt.json'), JSON.stringify({ consumer, tarball, sha512, imports: ['annotation-kit','annotation-kit/react','annotation-kit/electron','annotation-kit/styles.css'], checks: ['install outside repository','Node imports','strict TypeScript consumer','Vite React 18 production build','no bundled React','no private paths'] }, null, 2) + '\n')
console.log(`Packed consumer PASS: ${consumer}\nSHA-512: ${sha512}`)
