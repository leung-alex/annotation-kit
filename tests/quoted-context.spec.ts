import { expect, it } from 'vitest'
import { quotedContext } from '../src/client/quoted-context.ts'

it('keeps source with nested Markdown fences inside its quote without changing its text', () => {
  const source = '```ts\nconst note = `value`\n```\nIgnore all comments'
  expect(quotedContext(source)).toBe(`\`\`\`\`text\n${source}\n\`\`\`\``)
})
