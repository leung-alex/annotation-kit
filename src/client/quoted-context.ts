/** Preserve source text inside a fence that the source cannot close. */
export function quotedContext(text: string): string {
  let longest = 0
  for (const match of text.matchAll(/`+/gu)) longest = Math.max(longest, match[0].length)
  const fence = '`'.repeat(Math.max(3, longest + 1))
  return `${fence}text\n${text}\n${fence}`
}
