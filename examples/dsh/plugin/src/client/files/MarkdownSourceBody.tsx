import { useLayoutEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { MarkdownBody } from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/src/client/markdown/MarkdownBody.tsx'
import type { MarkdownBodyProps } from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/src/client/markdown/MarkdownBody.tsx'
import { markdownSourceRanges } from './markdown-ranges.ts'
import css from './MarkdownSourceBody.module.css'

/** Annotate the original DSH Markdown DOM after rendering, preserving its parser and styles. */
export function MarkdownSourceBody(props: MarkdownBodyProps): ReactNode {
  const scope = useRef<HTMLDivElement>(null)
  const source = props.content.kind === 'text' ? props.content.text : ''
  const eof = props.content.kind === 'text' && props.content.eof
  useLayoutEffect(() => {
    const host = scope.current
    if (host === null) return
    const refresh = (): void => {
      const markdown = host.querySelector<HTMLElement>('[data-document-markdown]')?.lastElementChild as HTMLElement | null | undefined
      if (markdown === null || markdown === undefined) return
      for (const child of markdown.children) {
        child.removeAttribute('data-annotation-source-start-line')
        child.removeAttribute('data-annotation-source-end-line')
        child.removeAttribute('data-textpreview-line')
      }
      // An incomplete stream can still change its block boundaries.
      if (!eof) return
      const children = Array.from(markdown.children)
      const ranges = markdownSourceRanges(source, children.length)
      // Fragment and raw-text renders may not have a one-to-one DOM block. No line claim is safer.
      if (ranges === undefined) return
      ranges.forEach((range, index) => {
        const element = children[index]
        if (element === undefined) return
        element.setAttribute('data-annotation-source-start-line', String(range.startLine))
        element.setAttribute('data-annotation-source-end-line', String(range.endLine))
        // Let the document owner's existing line-navigation land on this source block.
        element.setAttribute('data-textpreview-line', String(range.startLine))
      })
    }
    refresh()
    const observer = new MutationObserver(refresh)
    observer.observe(host, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [source, eof])
  return <div ref={scope} className={css.scope} data-annotation-markdown-source><MarkdownBody {...props} /></div>
}
