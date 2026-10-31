import { cpSync, mkdirSync } from 'node:fs'
mkdirSync('dist/electron', { recursive: true })
for (const name of ['guest-preload.cjs', 'element-context.cjs']) cpSync(`src/electron/${name}`, `dist/electron/${name}`)
cpSync('src/styles.d.ts', 'dist/styles.d.ts')
