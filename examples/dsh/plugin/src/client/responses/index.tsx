import { useLayoutEffect, useRef } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { AssistantTextOwnerProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { SessionId, SessionSeq } from '@deepseek-ai/dsh-session/types'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { AnnotationError } from '../errors.ts'
import type { ComposerBridge } from '../composer/index.tsx'
import { ResponseController } from './controller.ts'
import { ResponseOverlay } from './ResponseOverlay.tsx'
import css from './responses.module.css'

export function installResponseAnnotations(ctx: Context, composer: ComposerBridge): ResponseController {
  const controller = new ResponseController(composer, async (sessionId, seq) => {
    const binding = ctx.sessions.binding(sessionId as SessionId)
    if (!binding) throw new AnnotationError('error.responseUnavailable')
    await binding.session.loadThrough(seq as SessionSeq)
  })
  if (!composer.responses) throw new Error('Response annotations require the Composer reference adapter')
  composer.responses.open = (snapshot, edit, trigger) => controller.open(snapshot, edit, trigger)
  function TextSurface(props: AssistantTextOwnerProps & { sessionId: string }) {
    const root = useRef<HTMLDivElement>(null)
    const { sessionId, nodeKey, nodeId, turn, step, seq, blockIndex, text, reveal, fallback } = props
    useLayoutEffect(() => {
      if (!root.current) return
      return controller.register({ root: root.current, source: { sessionId, nodeKey, nodeId, turn, step, seq, blockIndex, text }, reveal })
    }, [sessionId, nodeKey, nodeId, turn, step, seq, blockIndex, text, reveal])
    return <div ref={root} className={css.source} data-response-source tabIndex={-1}>{fallback}</div>
  }
  ctx.effect(() => ctx.slots.inject('conversation.chat.assistant.text', () => ctx.slots.register({
    name: 'conversation.chat.assistant.text', inject: (sessionId: SessionId) => ({ sessionId }),
  }, TextSurface)))
  ctx.effect(() => ctx.slots.inject('conversation.input.overlay', () => ctx.slots.register({
    name: 'conversation.input.overlay', id: 'annotation-kit-response-annotations', order: 91, locale: 'annotations',
    inject: (sessionId: SessionId) => ({ sessionId, controller }),
  }, (props: PropsLocale<'annotations'> & { sessionId: string; controller: ResponseController }) => <ResponseOverlay {...props} />)))
  ctx.effect(() => () => { if (composer.responses) composer.responses.open = undefined; controller.dispose() })
  return controller
}
