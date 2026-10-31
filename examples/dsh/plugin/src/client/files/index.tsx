import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ComposerBridge } from '../composer/index.tsx'
import { actionComponent } from 'annotation-kit/react'
export { actionComponent } from 'annotation-kit/react'
import { MarkdownSourceBody } from './MarkdownSourceBody.tsx'
import { pageActionComponent } from './pages/PageSelectionAction.tsx'
import { sheetBodyComponent, SheetToolbar } from './sheets/SheetBody.tsx'
import { PageBatches } from './pages/batches.ts'
import { sheetRecoveryComponent } from './sheets/SheetRecovery.tsx'
const RENDERERS = [
  { kind: 'code', id: '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/code' },
  { kind: 'text', id: '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/text' },
  { kind: 'markdown', id: '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/markdown' },
] as const

/** Install one file action per existing renderer; only Markdown's body needs source mapping. */
export function installFileSelections(ctx: Context, bridge: ComposerBridge): void {
  const sheetBatches = new PageBatches()
  const SheetBody = sheetBodyComponent(bridge, ctx.locale.bind('annotations'), sheetBatches)
  const SheetRecovery = sheetRecoveryComponent(bridge, sheetBatches)
  ctx.effect(() => ctx.slots.inject('conversation.input.overlay', () => ctx.slots.register({
    name: 'conversation.input.overlay', id: '@annotation-kit/dsh-example/sheet-recovery', locale: 'annotations',
    inject: sessionId => ({ sessionId }),
  }, SheetRecovery)), 'annotation-kit: unavailable sheet snapshots')
  ctx.effect(() => ctx.slots.inject('sidebar.right.tab.document.actions', () => ctx.slots.register({
    name: 'sidebar.right.tab.document.actions', id: '@annotation-kit/dsh-example/sheets',
  }, SheetToolbar)), 'annotation-kit: spreadsheet toolbar')
  ctx.effect(() => ctx.slots.inject('sidebar.right.tab.document', () => ctx.slots.register({
    name: 'sidebar.right.tab.document', key: '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/excel',
    priority: -1, locale: 'sidebarExcel',
  }, SheetBody)), 'annotation-kit: spreadsheet selections')
  const PageAction = pageActionComponent(bridge)
  ctx.effect(() => ctx.slots.inject('sidebar.right.tab.document.actions', () => ctx.slots.register({
    name: 'sidebar.right.tab.document.actions', id: '@annotation-kit/dsh-example/pages', locale: 'annotations',
  }, PageAction)), 'annotation-kit: PDF and Office selections')
  for (const renderer of RENDERERS) {
    const Component = actionComponent(renderer.kind, bridge)
    ctx.effect(() => ctx.slots.inject('sidebar.right.tab.document.action', () => ctx.slots.register({
      name: 'sidebar.right.tab.document.action', key: renderer.id, locale: 'annotations',
    }, Component)), `annotation-kit: ${renderer.kind} selection action`)
  }
  ctx.effect(() => ctx.slots.inject('sidebar.right.tab.document', () => ctx.slots.register({
    name: 'sidebar.right.tab.document',
    key: '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/markdown',
    priority: -1,
    locale: 'documentMarkdown',
  }, MarkdownSourceBody)), 'annotation-kit: Markdown source ranges')
}
