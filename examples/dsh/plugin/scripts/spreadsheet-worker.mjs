import { readFileSync, readdirSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

/** Same pinned parser as DSH, compiled for a disposable classic browser Worker. */
export function spreadsheetWorker(runtimeRoot) {
  const root = join(runtimeRoot, 'packages/client/ui-sidebar-documentpreview')
  const require = createRequire(join(root, 'package.json'))
  const buildRequire = createRequire(import.meta.url)
  for (const name of ['@fortune-sheet/core', '@fortune-sheet/react']) {
    if (realpathSync(buildRequire.resolve(name)) !== realpathSync(require.resolve(name))
      || JSON.parse(readFileSync(require.resolve(`${name}/package.json`), 'utf8')).version !== '1.0.4') {
      throw new Error(`annotations: ${name} must reuse DSH's patched 1.0.4; an unpatched second copy breaks read-only remounts`)
    }
  }
  const { build } = buildRequire(buildRequire.resolve('esbuild', { paths: [dirname(buildRequire.resolve('vite'))] }))
  return {
    name: 'annotation-kit-spreadsheet-worker', enforce: 'pre',
    resolveId(source, importer) {
      return source === './worker.ts?raw' && importer?.replaceAll('\\', '/').includes('/excel/') ? '\0aione-excel-worker' : null
    },
    async load(id) {
      if (id !== '\0aione-excel-worker') return null
      const result = await build({ entryPoints: [join(root, 'src/client/excel/worker.ts')], bundle: true,
        write: false, format: 'iife', platform: 'browser', mainFields: ['browser', 'module', 'main'],
        minify: true, metafile: true, define: { 'process.env.NODE_ENV': '"production"' } })
      for (const path of Object.keys(result.metafile.inputs)) this.addWatchFile(path)
      return `export default ${JSON.stringify(result.outputFiles[0].text)}`
    },
    generateBundle(_options, bundle) {
      const notices = [readFileSync(join(root, 'licenses/FortuneSheet.txt'), 'utf8')]
      for (const name of ['exceljs', 'papaparse', 'fflate']) notices.push(readFileSync(join(dirname(require.resolve(`${name}/package.json`)), 'LICENSE'), 'utf8'))
      notices.push(readFileSync(join(dirname(dirname(require.resolve('fast-xml-parser'))), 'LICENSE'), 'utf8'))
      const xlsRoot = dirname(require.resolve('xlsx'))
      for (const name of readdirSync(xlsRoot).filter(n => /^(LICENSE|NOTICE)(\.|$)/u.test(n)).sort()) notices.push(readFileSync(join(xlsRoot, name), 'utf8'))
      const entry = bundle['client.js']
      if (entry?.type === 'chunk') entry.code = notices.join('\n').split('\n').map(line => `// ${line}`).join('\n') + '\n' + entry.code
    },
  }
}
