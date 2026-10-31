import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  resolve: { alias: [
    { find: /^annotation-kit\/react$/, replacement: fileURLToPath(new URL('../../src/react.ts', import.meta.url)) },
    { find: /^annotation-kit\/styles.css$/, replacement: fileURLToPath(new URL('../../dist/annotation-kit.css', import.meta.url)) },
    { find: /^annotation-kit$/, replacement: fileURLToPath(new URL('../../src/index.ts', import.meta.url)) },
  ], dedupe: ['react', 'react-dom'] },
  server: { host: '127.0.0.1', port: 4178, strictPort: true },
  build: { outDir: '../../.artifacts/react-demo', emptyOutDir: true },
})
