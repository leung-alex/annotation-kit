import { AnnotationError } from '../errors.ts'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { FileSnapshot } from './references.ts'
import { revealSpreadsheet } from './sheets/navigation.ts'

/** Page navigation waits for the existing renderer; it never fetches a second copy. */
export function openFileSnapshot(ctx: Context, snapshot: FileSnapshot): void | Promise<void> {
  if (snapshot.version === 1) {
    ctx.sidebarRight.openResource(snapshot.address, { params: { line: snapshot.startLine } })
    return
  }
  ctx.sidebarRight.openResource(snapshot.address)
  if (snapshot.version === 3) return new Promise<void>((resolve, reject) => {
    const finish = (error?: unknown) => { observer.disconnect(); clearTimeout(timeout); error ? reject(error) : resolve() }
    const reveal = () => { try { if (revealSpreadsheet(snapshot)) finish() } catch (error) { finish(error) } }
    const observer = new MutationObserver(reveal)
    const timeout = setTimeout(() => finish(new AnnotationError('error.sourceUnavailable')), 10000)
    observer.observe(document.body, { subtree: true, childList: true }); reveal()
  })
  const observer = new MutationObserver(reveal)
  const timeout = setTimeout(() => observer.disconnect(), 10000)
  function reveal() {
    const preview = [...document.querySelectorAll<HTMLElement>('[data-textpreview-url]')].find(node => node.dataset.textpreviewUrl === snapshot.address)
    const page = preview?.querySelector<HTMLElement>(`[data-pdf-page="${snapshot.version === 2 ? snapshot.startPage : 1}"]`)
    if (!page) return
    page.scrollIntoView({ block: 'start' }); observer.disconnect(); clearTimeout(timeout)
  }
  observer.observe(document.body, { subtree: true, childList: true }); reveal()
}
