/** An isolated, version-pinned DSH example; never modifies an existing application checkout. */
import { spawn, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, createWriteStream } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { renderAnnotationGuestPreload } from '../../dist/electron.js'

export const BASELINE = 'b830ec950faba0a46dda564be3e2d854afed94f1'
const root = fileURLToPath(new URL('../../', import.meta.url))
const runtime = join(root, '.dsh', 'runtime')
const stateFile = join(root, '.dsh', 'example-state.json')
const patchFile = fileURLToPath(new URL('./patches/dsh-0.2.1-rc.5.patch', import.meta.url))
const plugin = join(runtime, '.annotation-kit-plugin')
const logs = join(runtime, '.logs', 'annotation-kit')
const manager = process.env.npm_execpath
const git = (...args) => execFileSync('git', ['-C', runtime, ...args], { encoding: 'utf8', windowsHide: true }).trimEnd()
const digest = path => createHash('sha256').update(readFileSync(path)).digest('hex')
const normalize = path => path.split(sep).join('/')
const patchPaths = [...readFileSync(patchFile, 'utf8').matchAll(/^\+\+\+ b\/(.+)$/gm)].map(match => match[1])
const { positionals, values } = parseArgs({ allowPositionals: true, options: { package: { type: 'string' }, source: { type: 'string' } } })
const command = positionals[0] ?? 'check'

function inside(path) {
  const part = relative(runtime, resolve(path))
  if (!part || part.startsWith('..') || part.includes(`..${sep}`)) throw new Error('Refusing a path outside the owned example runtime')
  return path
}
function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (['node_modules', 'lib', '.logs', '.git'].includes(entry.name)) return []
    const path = join(directory, entry.name)
    return entry.isDirectory() ? files(path) : [path]
  })
}
function readState() { return JSON.parse(readFileSync(stateFile, 'utf8')) }
function saveState(phase, packagePath) {
  const owned = [...patchPaths, 'pnpm-lock.yaml', ...files(plugin).map(path => normalize(relative(runtime, path)))]
  const hashes = Object.fromEntries(owned.filter(path => existsSync(join(runtime, path))).map(path => [path, digest(join(runtime, path))]))
  writeFileSync(stateFile, JSON.stringify({ version: 1, baseline: BASELINE, patch: digest(patchFile), phase, packagePath, hashes }, null, 2) + '\n')
}
function check() {
  if (git('rev-parse', 'HEAD') !== BASELINE) throw new Error(`Expected DSH rc.5 ${BASELINE}; refusing this checkout`)
  const state = readState()
  if (state.patch !== digest(patchFile) || state.baseline !== BASELINE) throw new Error('Patch or version changed; use a fresh example runtime')
  for (const [path, expected] of Object.entries(state.hashes)) {
    if (!existsSync(join(runtime, path)) || digest(join(runtime, path)) !== expected) throw new Error(`Unregistered edit: ${path}`)
  }
  for (const path of files(plugin).map(path => normalize(relative(runtime, path)))) {
    if (!(path in state.hashes)) throw new Error(`Unregistered edit: ${path}`)
  }
  for (const line of git('status', '--porcelain', '--untracked-files=all').split('\n').filter(Boolean)) {
    const path = line.slice(3).replaceAll('"', '')
    if (!(path in state.hashes)) throw new Error(`Unregistered edit: ${path}`)
  }
  return state
}
async function run(label, args, cwd = runtime, environment = {}) {
  mkdirSync(logs, { recursive: true })
  // Commands run through pnpm's JavaScript entry, without shell interpolation.
  if (!manager || !/pnpm/i.test(manager)) throw new Error('Run through pnpm run dsh:<command> so the pinned package manager is available')
  const output = createWriteStream(join(logs, `${label}.log`), { flags: 'w' })
  console.log(`${label}: ${args.join(' ')} (log: ${join(logs, `${label}.log`)})`)
  try {
    await new Promise((resolveRun, reject) => {
      const env = { ...process.env, ...environment }
      delete env.ELECTRON_RUN_AS_NODE
      const child = spawn(process.execPath, [manager, ...args], { cwd, env, windowsHide: true, stdio: ['inherit', 'pipe', 'pipe'] })
      child.stdout.on('data', data => { output.write(data); process.stdout.write(data) })
      child.stderr.on('data', data => { output.write(data); process.stderr.write(data) })
      child.on('error', reject)
      child.on('exit', code => code === 0 ? resolveRun() : reject(new Error(`${label} exited ${code}`)))
    })
  } finally { output.end() }
}
async function prepare() {
  if (existsSync(stateFile)) {
    const state = check()
    if (['patched', 'install-failed'].includes(state.phase)) {
      try {
        await run('install', ['install', '--no-frozen-lockfile'])
        await run('plugin-install', ['install'], plugin)
        saveState('prepared', state.packagePath)
      } catch (error) { saveState('install-failed', state.packagePath); throw error }
    } else console.log(`Already prepared (${state.phase})`)
    return
  }
  const packagePath = values.package ? resolve(values.package) : undefined
  if (packagePath && !existsSync(packagePath)) throw new Error(`Package not found: ${packagePath}`)
  mkdirSync(dirname(runtime), { recursive: true })
  if (!existsSync(join(runtime, '.git'))) {
    const source = values.source ? resolve(values.source) : 'https://github.com/deepseek-ai/deepseek-harness.git'
    execFileSync('git', ['clone', '--branch', 'dsh-v0.2.1-rc.5', '--single-branch', source, runtime], { stdio: 'inherit', windowsHide: true })
  }
  if (git('rev-parse', 'HEAD') !== BASELINE || git('status', '--porcelain')) throw new Error('Prepare requires a clean rc.5 checkout; no files were replaced')
  const exclude = join(runtime, '.git', 'info', 'exclude')
  writeFileSync(exclude, readFileSync(exclude, 'utf8') + '\n.annotation-kit-plugin/\n.logs/\n')
  git('apply', '--check', patchFile)
  git('apply', patchFile)
  cpSync(fileURLToPath(new URL('./plugin', import.meta.url)), plugin, { recursive: true })
  const manifest = JSON.parse(readFileSync(join(plugin, 'package.json'), 'utf8'))
  if (packagePath) {
    manifest.dependencies['annotation-kit'] = `file:${normalize(packagePath)}`
    const desktopPath = join(runtime, 'apps/desktop/package.json')
    const desktop = JSON.parse(readFileSync(desktopPath, 'utf8'))
    desktop.dependencies['annotation-kit'] = `file:${normalize(packagePath)}`
    writeFileSync(desktopPath, JSON.stringify(desktop, null, 2) + '\n')
  }
  for (const [key, value] of Object.entries(manifest.devDependencies)) {
    if (value.startsWith('link:')) {
      const suffix = key === '@deepseek-ai/dsh-client-ui-layout' ? 'packages/client/ui-layout' : value.slice(5)
      manifest.devDependencies[key] = `link:${normalize(join(runtime, suffix))}`
    }
  }
  writeFileSync(join(plugin, 'package.json'), JSON.stringify(manifest, null, 2) + '\n')
  saveState('patched', packagePath)
  try {
    await run('install', ['install', '--no-frozen-lockfile'])
    await run('plugin-install', ['install'], plugin)
    saveState('prepared', packagePath)
  } catch (error) { saveState('install-failed', packagePath); throw error }
}
async function build() {
  const state = check()
  await run('build', ['run', 'build:artifacts'])
  await run('plugin-build', ['run', 'build'], plugin, { ANNOTATION_DSH_RUNTIME: runtime })
  writeFileSync(join(runtime, 'apps/desktop/lib/annotation-guest-preload.cjs'), renderAnnotationGuestPreload())
  saveState('built', state.packagePath)
}
async function start() {
  const state = check()
  if (state.phase !== 'built') throw new Error('Run pnpm dsh:build first')
  const env = { DSH_HOME: join(root, '.dsh/data'), DSH_DESKTOP_USER_DATA_DIR: join(root, '.dsh/electron-data'),
    ANNOTATION_KIT_LOCAL_DEMO: '1',
    DSH_DESKTOP_MAIN_INSPECT_PORT: '9429', DSH_DESKTOP_RENDERER_DEBUG_PORT: '9422', DSH_DESKTOP_HOST_INSPECT_PORT: '9430', DSH_DESKTOP_OPEN_DEVTOOLS: '0' }
  await run('desktop', ['run', 'start:desktop'], runtime, env)
}
function revert() {
  check()
  const desktopPath = join(runtime, 'apps/desktop/package.json')
  const desktop = JSON.parse(readFileSync(desktopPath, 'utf8'))
  desktop.dependencies['annotation-kit'] = '0.1.0'
  writeFileSync(desktopPath, JSON.stringify(desktop, null, 2) + '\n')
  git('apply', '--reverse', '--check', patchFile)
  git('apply', '--reverse', patchFile)
  writeFileSync(join(runtime, 'pnpm-lock.yaml'), execFileSync('git', ['-C', runtime, 'show', 'HEAD:pnpm-lock.yaml'], { maxBuffer: 16 * 1024 * 1024, windowsHide: true }))
  // Only this generated plugin directory is removed, after its hashes and absolute location were checked.
  rmSync(inside(plugin), { recursive: true })
  rmSync(stateFile)
  console.log('Source patch reverted. Isolated data and build outputs are retained; reinstall before running stock DSH.')
}
try {
  if (command === 'prepare') await prepare()
  else if (command === 'build') await build()
  else if (command === 'start') await start()
  else if (command === 'revert') revert()
  else if (command === 'check') { const state = check(); console.log(`DSH rc.5 example integrity PASS (${state.phase})`) }
  else throw new Error(`Unknown command: ${command}`)
} catch (error) { console.error(error.message); process.exitCode = 1 }
