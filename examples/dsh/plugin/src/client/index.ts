import 'annotation-kit/styles.css'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-browser/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type { AnnotationKey } from './locales.ts'
import { en, zh } from './locales.ts'
import { installComposer } from './composer/index.tsx'
import { installFileSelections } from './files/index.tsx'
import { AnnotationsModel } from './model.ts'
import { AnnotationButton, AnnotationOverlay } from './Workbench.tsx'
import styles from 'virtual:annotation-kit-css'
import { SentAnnotations } from './messages/SentAnnotations.tsx'
import { readSentFile, type FileSnapshot } from './files/references.ts'
import { readAnnotation } from './messages/presentation.ts'
import { openFileSnapshot } from './files/open.ts'
import { installResponseAnnotations } from './responses/index.tsx'
import { readSentResponse, type ResponseAnnotationSnapshot } from './responses/references.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { annotations: AnnotationKey }
}

export const inject = ['slots', 'locale', 'sessions', 'conversation', 'layout', 'inputTriggers', 'sidebarRight']

/** One plugin lifetime owns both toolbar installations and every pending operation. */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('annotations', { zh, en }))
  ctx.effect(() => {
    const node = document.createElement('style')
    node.dataset.pluginCss = '@annotation-kit/dsh-example'
    node.textContent = styles
    document.head.append(node)
    return () => { node.remove() }
  })
  const composer = installComposer(ctx)
  const responses = installResponseAnnotations(ctx, composer)
  ctx.effect(() => ctx.slots.inject('conversation.message.content', () => ctx.slots.register({
    name: 'conversation.message.content', priority: -20, locale: 'annotations',
    inject: () => ({ openFile: (snapshot: FileSnapshot) => openFileSnapshot(ctx, snapshot),
      openResponse: (snapshot: ResponseAnnotationSnapshot) => responses.open(snapshot, false) }),
  }, SentAnnotations)))
  ctx.effect(() => () => composer.dispose())
  installFileSelections(ctx, composer)
  if (window.annotationKitDesktop?.protocolVersion !== 1) return
  const model = new AnnotationsModel(window.annotationKitDesktop, composer)
  composer.editAnnotation = model.edit
  ctx.effect(() => () => model.dispose())
  ctx.effect(() => composer.subscribe(model.refresh))
  const face = () => ({ model })
  ctx.effect(() => ctx.slots.inject('sidebar.right.tab.browser.actions', () => ctx.slots.register({
    name: 'sidebar.right.tab.browser.actions', id: '@annotation-kit/dsh-example/tool', locale: 'annotations', inject: face,
  }, AnnotationButton)))
  ctx.effect(() => ctx.slots.inject('sidebar.right.tab.browser.panel', () => ctx.slots.register({
    name: 'sidebar.right.tab.browser.panel', id: '@annotation-kit/dsh-example/panel', locale: 'annotations', inject: face,
  }, AnnotationOverlay)))
}
