import type { InputState } from '../../host-contracts.ts'

/** Keep restored Lexical references behind the plugin's grouped attachment UI. */
export function bindReferencePresentation(
  card: Element,
  input: Pick<InputState, 'occurrences' | 'draft'>,
  owns: (source: string, ref: string) => boolean,
): () => void {
  const nodes = new Set<HTMLElement>()
  const editors = new Set<HTMLElement>()
  const sync = (): void => {
    const indexes = new Map<string, number>()
    for (const node of card.querySelectorAll<HTMLElement>('[data-composer-chip]')) {
      const source = node.dataset.composerChip!
      const index = indexes.get(source) ?? 0
      indexes.set(source, index + 1)
      const ref = input.occurrences.filter(item => item.source === source)[index]
      const owned = !!ref && owns(source, ref.ref)
      if (owned || nodes.has(node)) node.toggleAttribute('data-aione-annotation-owned', owned)
      if (owned) nodes.add(node)
    }
    const refs = input.occurrences.filter(item => owns(item.source, item.ref))
    let visibleText = input.draft
    for (const ref of [...refs].reverse()) visibleText = visibleText.slice(0, ref.offset) + visibleText.slice(ref.offset + ref.length)
    const editor = card.querySelector<HTMLElement>('[contenteditable="true"]')
    if (editor) {
      editors.add(editor)
      editor.toggleAttribute('data-aione-annotation-only', refs.length > 0 && !visibleText.trim())
    }
  }
  sync()
  // Lexical may mount restored chips after the overlay slot's layout effect.
  const observer = new MutationObserver(sync)
  observer.observe(card, { childList: true, subtree: true })
  return () => {
    observer.disconnect()
    nodes.forEach(node => node.removeAttribute('data-aione-annotation-owned'))
    editors.forEach(editor => editor.removeAttribute('data-aione-annotation-only'))
  }
}
