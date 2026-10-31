/** Bundle the pinned MIT react-grab primitives into one sandbox-compatible CJS preload. */
import { readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const moduleDirectory = dirname(fileURLToPath(import.meta.url))
const PLACEHOLDER = '/* AIONE_REACT_GRAB_PRIMITIVES */ null'

export function renderAnnotationGuestPreload({ channelPrefix = 'annotation-kit' } = {}) {
  const annotationsRequire = createRequire(import.meta.url)
  const assets = existsSync(join(moduleDirectory, 'electron', 'guest-preload.cjs')) ? join(moduleDirectory, 'electron') : moduleDirectory
  const manifest = annotationsRequire('react-grab/package.json')
  if (manifest.version !== '0.2.0') throw new Error('annotation-kit: react-grab primitive version must remain 0.2.0')
  const license = readFileSync(join(dirname(annotationsRequire.resolve('react-grab/package.json')), 'LICENSE'), 'utf8')
  if (!license.includes('MIT License') || license.includes('*/')) {
    throw new Error('annotation-kit: react-grab license changed; review the preload bundle')
  }
  const entry = annotationsRequire.resolve('react-grab/primitives')
  const dist = dirname(entry)
  const modules = new Map()
  const keyFor = path => `./${relative(dist, path).split(sep).join('/')}`
  const visit = path => {
    const key = keyFor(path)
    if (modules.has(key)) return
    if (!key.startsWith('./') || key.includes('../') || !key.endsWith('.cjs')) {
      throw new Error(`annotation-kit: react-grab primitive escaped its CJS distribution: ${key}`)
    }
    const code = readFileSync(path, 'utf8')
    const dependencies = {}
    for (const match of code.matchAll(/require\([`'"]([^`'"]+)[`'"]\)/g)) {
      const dependency = match[1]
      if (!dependency.startsWith('./')) {
        throw new Error(`annotation-kit: react-grab primitive gained an external dependency: ${dependency}`)
      }
      const target = resolve(dirname(path), dependency)
      dependencies[dependency] = keyFor(target)
      visit(target)
    }
    modules.set(key, { code, dependencies })
  }
  visit(entry)
  const factories = [...modules.entries()].map(([key, value]) =>
    `${JSON.stringify(key)}: [function(require, module, exports) {\n${value.code}\n}, ${JSON.stringify(value.dependencies)}]`).join(',\n')
  const bundled = `(() => {\n  /* react-grab 0.2.0 license:\n${license}\n  */\n  const modules = {${factories}}\n  const cache = Object.create(null)\n  function load(id) {\n    if (cache[id]) return cache[id].exports\n    const entry = modules[id]\n    if (!entry) throw new Error('aione annotation primitive module is unavailable')\n    const module = { exports: {} }\n    cache[id] = module\n    entry[0](specifier => load(entry[1][specifier]), module, module.exports)\n    return module.exports\n  }\n  return load(${JSON.stringify(keyFor(entry))})\n})()`
  const source = readFileSync(join(assets, 'guest-preload.cjs'), 'utf8')
  if (source.split(PLACEHOLDER).length !== 2) throw new Error('annotation-kit: guest primitive hook changed')
  const contextSource = readFileSync(join(assets, 'element-context.cjs'), 'utf8')
  const contextPlaceholder = '/* AIONE_ELEMENT_CONTEXT */ null'
  if (source.split(contextPlaceholder).length !== 2) throw new Error('annotation-kit: guest element context hook changed')
  return source.replace(PLACEHOLDER, () => bundled).replace(contextPlaceholder,
    () => `(() => { const module = { exports: {} };\n${contextSource}\nreturn module.exports })()`)
    .replaceAll('aione-desktop:', `${channelPrefix}:`)
}
