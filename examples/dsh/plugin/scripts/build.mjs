/** Vite CSS Modules + DSH lazy-CJS protocol for an out-of-tree client plugin. */
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { transformWithEsbuild } from 'vite'
import { build as buildClient } from 'vite'
import { spreadsheetWorker } from './spreadsheet-worker.mjs'

const packageRoot = fileURLToPath(new URL('../', import.meta.url))
const runtimeRoot = resolve(process.env.ANNOTATION_DSH_RUNTIME ?? resolve(packageRoot, '../../../.dsh/runtime'))
const compatibleCommit = 'b830ec950faba0a46dda564be3e2d854afed94f1'
if (execFileSync('git', ['-C', runtimeRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !== compatibleCommit) {
  throw new Error('Review the DSH adapter before building against another baseline')
}
const platformSource = readFileSync(resolve(runtimeRoot, 'packages/client/web/src/platform.ts'), 'utf8')
const platformCode = await transformWithEsbuild(platformSource, 'platform.ts', { loader: 'ts' })
const { PLATFORM_MODULES, PRELOADED_CLIENT_EXTERNALS } = await import(`data:text/javascript;base64,${Buffer.from(platformCode.code).toString('base64')}`)
const shared = new Set([...PLATFORM_MODULES, ...PRELOADED_CLIENT_EXTERNALS])
const placeholder = '__AIONE_COMPONENT_STYLES__'

const lazyClient = {
  name: 'annotation-kit-dsh-lazy-client',
  enforce: 'post',
  resolveId(id) {
    if (id === 'virtual:annotation-kit-css') return '\0aione-annotations-css'
    if (shared.has(id)) return { id, external: true }
    if (id.startsWith('@deepseek-ai/dsh-client-ui-primitives/src/')) return undefined
    if (id.startsWith('@deepseek-ai/dsh-client-ui-sidebar-documentpreview/src/')) return undefined
    if (id.startsWith('@deepseek-ai/dsh-client-ui-attachment/src/')) return undefined
    if (id.startsWith('@deepseek-ai/dsh-util-workspace-path/src/')) return undefined
    if (id.startsWith('@deepseek-ai/') || id === 'react' || id.startsWith('react/') || id.startsWith('react-dom')) {
      throw new Error(`annotations cannot privately bundle platform or feature module: ${id}`)
    }
  },
  load(id) {
    if (id === '\0aione-annotations-css') return `export default ${JSON.stringify(placeholder)}`
  },
  generateBundle: {
    order: 'post',
    handler(_options, bundle) {
      const styles = Object.values(bundle).filter(output => output.type === 'asset' && output.fileName.endsWith('.css'))
      const text = styles.map(output => output.source.toString()).join('\n')
      const entry = bundle['client.js']
      if (!entry || entry.type !== 'chunk') throw new Error('Missing lazy-CJS client entry')
      if (!entry.code.includes(JSON.stringify(placeholder))) throw new Error('Missing lifecycle-owned component stylesheet')
      entry.code = entry.code.replace(JSON.stringify(placeholder), JSON.stringify(text))
      for (const output of styles) delete bundle[output.fileName]
      for (const output of Object.values(bundle)) {
        if (output.type === 'asset' && !output.fileName.endsWith('.map')) throw new Error(`Unsupported plugin asset: ${output.fileName}`)
      }
    },
  },
}

const definitions = {
  'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
  'process.env.DSH_CLIENT_TITLE': 'undefined',
  'process.env.DSH_CLIENT_VERSION': 'undefined',
  'process.env.DSH_CLIENT_COMMIT_HASH': 'undefined',
  'process.env.DSH_CLIENT_GIT_DIRTY': 'undefined',
}
const runtimeBuild = { environment: {} }
for (const [key, value] of Object.entries({ ...runtimeBuild.environment, ...process.env })) {
  if (key.startsWith('DSH_CLIENT_')) definitions[`process.env.${key}`] = JSON.stringify(value)
}

writeFileSync(resolve(packageRoot, 'lib/index.js'), 'export * from ' + JSON.stringify('./types/index.js') + String.fromCharCode(10))
await buildClient({
  configFile: false,
  root: packageRoot,
  define: definitions,
  plugins: [spreadsheetWorker(runtimeRoot), lazyClient],
  esbuild: { jsx: 'automatic' },
  build: {
    outDir: 'lib',
    emptyOutDir: false,
    minify: false,
    sourcemap: true,
    cssCodeSplit: false,
    watch: process.argv.includes('--watch') ? {} : undefined,
    lib: { entry: resolve(packageRoot, 'src/client/index.ts'), formats: ['cjs'], fileName: () => 'client.js' },
    rollupOptions: {
      external: id => shared.has(id),
      output: {
        inlineDynamicImports: true,
        // Source: dsh/packages/client/tsdown.client.ts, commit 639ed015397290b3745d163aafe02ffee4aa3f84 (MIT).
        banner: 'window.__ModuleLoader__.load({ id: "@annotation-kit/dsh-example", factory: (require) => {',
        intro: 'var module = { exports: {} }; var exports = module.exports;',
        footer: 'return module.exports; } });',
      },
    },
  },
})
