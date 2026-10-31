import { defineConfig } from 'vite'
import { resolve } from 'node:path'

export default defineConfig({
  build: {
    target: 'es2022',
    sourcemap: true,
    minify: false,
    cssCodeSplit: false,
    lib: {
      entry: { index: resolve('src/index.ts'), react: resolve('src/react.ts'), electron: resolve('src/electron/index.ts') },
      formats: ['es'],
      fileName: (_format, name) => `${name}.js`,
      cssFileName: 'annotation-kit',
    },
    rollupOptions: {
      external: id => /^(react(?:\/|$)|react-dom(?:\/|$)|node:|electron$|react-grab(?:\/|$))/.test(id),
      output: { chunkFileNames: 'chunks/[name]-[hash].js' },
    },
  },
})
