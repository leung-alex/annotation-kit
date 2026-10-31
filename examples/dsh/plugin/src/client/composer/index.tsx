import { AnnotationError, annotationFailure, annotationErrorText } from '../errors.ts'
import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { InputActions, InputState, ComposerAttachmentsProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { ComposerAttachments } from '@deepseek-ai/dsh-client-ui-attachment/src/client/ComposerAttachments.tsx'
import { commitToComposer } from './commit.ts'
import { draftFactory, imageDrafts } from './attachments.ts'
import { AnnotationPackets, ANNOTATION_SOURCE, packetSpan, type AnnotationEntry } from './packets.ts'
import { PacketPreview } from './PacketPreview.tsx'
import { bindReferencePresentation } from './reference-presentation.ts'
import { assertFileDraftCapacity, decodeFileReference, FILE_SELECTION_SOURCE, fileLabel, fileReference, selectedFiles, serializeFileReference, type FileSnapshot } from '../files/references.ts'
import { SelectionCard } from '../files/SelectionCard.tsx'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { PageImages } from '../files/pages/images.ts'
import { openFileSnapshot } from '../files/open.ts'
import { sendPageBatch, type PageSendRequest } from './page-send.ts'
import { assertResponseCapacity, decodeResponseReference, RESPONSE_SOURCE, responseReference, responseSelections, serializeResponseReference, type ResponseAnnotationSnapshot } from '../responses/references.ts'
import type { ResponseComposer } from '../responses/composer.ts'
import { ResponseCard } from '../responses/ResponseCard.tsx'

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap {
    annotationKitExample: unknown
  }
}

export interface ComposerAddRequest {
  readonly text: string
  readonly images?: readonly File[]
  readonly annotations?: readonly AnnotationEntry[]
  readonly fileSelection?: FileSnapshot
  readonly responseSelection?: ResponseAnnotationSnapshot
  readonly signal?: AbortSignal
  readonly expectedTarget?: string
  readonly focus?: boolean
}

export interface ComposerBridge {
  readonly responses?: ResponseComposer
  sendPages?(request: PageSendRequest): Promise<void>
  annotationControls?(): { count: number; entries: readonly AnnotationEntry[]; edit(id: number): void; remove(id: number): void; review(): void; clear(): void; send(): void }
  editAnnotation?: (entry: AnnotationEntry, commit: (comment: string) => void) => boolean
  add(request: ComposerAddRequest): Promise<void>
  hasTarget(): boolean
  targetKey(): string | undefined
  subscribe(listener: () => void): () => void
  dispose(): void
}

interface ComposerHandle {
  readonly actions: InputActions
  readonly input: () => InputState
}

interface ImageLimits {
  readonly mediaTypes: readonly string[]
  readonly maxImagesPerMessage: number
  readonly maxImageBytes: number
  readonly maxMessageImageBytes: number
}

function selectedSession(ctx: Context): SessionId | undefined {
  const rows = Object.values(ctx.sessions.list.getSnapshot().byId)
    .filter(row => (row.retainedBy.mainView ?? 0) > 0)
  return rows.length === 1 ? rows[0]?.id : undefined
}

/** Publish only the Composer belonging to this exact, mounted Session. */
export function installComposer(ctx: Context): ComposerBridge {
  const packets = new AnnotationPackets()
  const pageImages = new PageImages()
  const t = ctx.locale.bind('annotations')
  const openFile = (snapshot: FileSnapshot) => openFileSnapshot(ctx, snapshot)
  ctx.effect(() => ctx.inputTriggers.registerSource({
    trigger: '@', name: RESPONSE_SOURCE, candidates: async () => [], onPick: () => undefined,
    openReference: (_session, reference) => {
      const snapshot = decodeResponseReference(reference.ref)
      if (!snapshot) return false
      void responses.open?.(snapshot, false).catch(() => undefined)
      return true
    },
    codec: {
      clipboardText: () => `[${t('response.title')}]`,
      serialize: async (ref, signal) => {
        try { return serializeResponseReference(ref, signal) }
        catch (error) { throw new Error(annotationErrorText(annotationFailure(error), t), { cause: error }) }
      },
    },
  }))
  ctx.effect(() => ctx.inputTriggers.registerSource({
    trigger: '@', name: FILE_SELECTION_SOURCE, candidates: async () => [], onPick: () => undefined,
    openReference: (_session, reference) => {
      const snapshot = decodeFileReference(reference.ref)
      if (!snapshot) return false
      void Promise.resolve(openFile(snapshot)).catch(() => undefined)
      return true
    },
    codec: {
      clipboardText: ref => {
        const snapshot = decodeFileReference(ref)
        return snapshot ? `[${fileLabel(snapshot)}]` : t('file.selections')
      },
      serialize: async (ref, signal) => {
        try {
          const snapshot = decodeFileReference(ref)
          if (snapshot) pageImages.validate(snapshot)
          return serializeFileReference(ref, signal)
        } catch (error) {
          throw new Error(annotationErrorText(annotationFailure(error), t), { cause: error })
        }
      },
    },
  }))
  ctx.effect(() => ctx.inputTriggers.registerSource({
    trigger: '@', name: ANNOTATION_SOURCE, candidates: async () => [], onPick: () => undefined,
    openReference: (session, reference) => packets.open(session.sessionId, reference.ref),
    codec: { clipboardText: ref => packets.get(ref)?.label ?? t('packet.title'),
      serialize: async (ref, signal) => {
        try { return await packets.serialize(ref, signal) }
        catch (error) { throw new Error(annotationErrorText(annotationFailure(error), t), { cause: error }) }
      } },
  }))
  const handles = new Map<SessionId, ComposerHandle>()
  const listeners = new Set<() => void>()
  const waiters = new Set<() => void>()
  let disposed = false
  let bridgeRevision = 0
  const changed = (): void => {
    bridgeRevision += 1
    for (const listener of listeners) listener()
    for (const wake of waiters) wake()
  }
  const listUnsubscribe = ctx.sessions.list.subscribe(changed)
  const packetUnsubscribe = packets.subscribe(changed)
  const responseHandle = (sessionId: string) => {
    const handle = handles.get(sessionId as SessionId)
    if (disposed || selectedSession(ctx) !== sessionId) throw new AnnotationError('error.sessionChangedAdd')
    if (!handle) throw new AnnotationError('error.composerNotReady')
    if (handle.input().phase !== 'plain') throw new AnnotationError('error.composerBusy')
    return handle
  }
  const responses: ResponseComposer = {
    read: sessionId => {
      const input = handles.get(sessionId as SessionId)?.input()
      return input ? responseSelections(input).map(item => item.snapshot) : []
    },
    replace(snapshot) {
      const handle = responseHandle(snapshot.sessionId)
      const input = handle.input()
      const original = responseSelections(input).find(item => item.snapshot.id === snapshot.id)
      if (!original) throw new AnnotationError('error.draftChanged')
      // Comments can change; the captured source and selected text cannot.
      const reference = responseReference({ ...original.snapshot, comment: snapshot.comment }, t('response.title'))
      assertResponseCapacity(input, reference.ref, snapshot.id)
      if (ctx.sessions.scope(snapshot.sessionId as SessionId)?.bail('slash/input-insert-reference', { reference, span: original.span }) !== true) {
        throw new AnnotationError('error.draftChanged')
      }
    },
    remove(sessionId, id) {
      const handle = responseHandle(sessionId)
      const item = responseSelections(handle.input()).find(item => item.snapshot.id === id)
      if (item && !handle.actions.insertText('', item.span)) throw new AnnotationError('error.draftChanged')
    },
    clear(sessionId) {
      const handle = responseHandle(sessionId)
      for (const item of responseSelections(handle.input()).reverse()) {
        if (!handle.actions.insertText('', { ...item.span, draftRev: handle.actions.captureInsertion().draftRev })) throw new AnnotationError('error.draftChanged')
      }
    },
    focus(sessionId) {
      if (selectedSession(ctx) === sessionId) document.querySelector<HTMLElement>('[data-composer-card] [contenteditable="true"]')?.focus()
    },
  }
  const bridge: ComposerBridge = {
    responses,
    async sendPages(request) {
      const id = selectedSession(ctx)
      if (disposed || !id || id !== request.expectedTarget) throw new AnnotationError('error.sessionChangedSend')
      const binding = ctx.sessions.binding(id)
      if (!binding) throw new AnnotationError('error.sessionNotReady')
      const limits = binding.session.projections.faceOf('imageLimits').getSnapshot() as ImageLimits | undefined
      if (request.images.length && (!limits || request.images.length > limits.maxImagesPerMessage
        || request.images.some(image => !limits.mediaTypes.includes(image.type) || image.size > limits.maxImageBytes)
        || request.images.reduce((size, image) => size + image.size, 0) > limits.maxMessageImageBytes)) throw new AnnotationError('error.imageLimit')
      const reference = ctx.sessions.retain(id, { source: 'annotationKitExample' })
      try { await sendPageBatch(ctx.conversation, binding.session, request) } finally { reference.release() }
    },
    annotationControls() {
      const id = selectedSession(ctx)
      const handle = id ? handles.get(id) : undefined
      const input = handle?.input()
      const refs = input?.occurrences.filter(item => item.source === ANNOTATION_SOURCE) ?? []
      const active = refs.flatMap(ref => { const packet = packets.get(ref.ref); return packet ? [packet] : [] })
      return { count: refs.length, entries: active.flatMap(packet => packet.entries),
        remove: number => {
          if (!input || input.phase !== 'plain' || !handle) return
          const packet = active.find(item => item.entries.some(entry => entry.id === number))
          const span = packet && packetSpan(input, packet.id)
          if (span) handle.actions.insertText('', span)
        },
        edit: number => {
          for (const packet of active) {
            const index = packet.entries.findIndex(entry => entry.id === number)
            const entry = packet.entries[index]
            if (entry) bridge.editAnnotation?.(entry, comment => packets.edit(packet.id, index, comment))
          }
        },
        review: () => { if (id && refs[0]) packets.open(id, refs[0].ref) },
        clear: () => {
          if (!input || input.phase !== 'plain' || !handle) return
          for (const ref of [...refs].reverse()) {
            const span = packetSpan(input, ref.ref)
            if (span) handle.actions.insertText('', { ...span, draftRev: handle.actions.captureInsertion().draftRev })
          }
        },
        send: () => { if (input?.phase === 'plain') handle?.actions.submit() },
      }
    },
    hasTarget: () => !disposed && selectedSession(ctx) !== undefined,
    targetKey: () => disposed ? undefined : selectedSession(ctx),
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    async add({ text, images = [], annotations, fileSelection, responseSelection, signal, expectedTarget, focus = true }) {
      if (disposed) throw new AnnotationError('error.disposed')
      signal?.throwIfAborted()
      if (text.trim() === '' && images.length === 0 && !fileSelection && !responseSelection) throw new AnnotationError('error.emptyContent')
      if (responseSelection && (fileSelection || annotations || images.length)) throw new AnnotationError('error.responseInvalid')
      const page = fileSelection?.version === 2 && fileSelection.image ? fileSelection : undefined
      if (fileSelection && (annotations || images.length !== (page ? 1 : 0))) throw new AnnotationError('error.fileImageMismatch')
      if (annotations && (annotations.length !== images.length || annotations.some((entry, index) => entry.image !== images[index]))) {
        throw new AnnotationError('error.imageMismatch')
      }
      const id = selectedSession(ctx)
      if (id === undefined) throw new AnnotationError('error.noSession')
      if (expectedTarget !== undefined && id !== expectedTarget) throw new AnnotationError('error.sessionChangedAdd')
      if (responseSelection && responseSelection.sessionId !== id) throw new AnnotationError('error.sessionChangedAdd')
      const binding = ctx.sessions.binding(id)
      if (binding === undefined) throw new AnnotationError('error.sessionNotReady')
      const reference = ctx.sessions.retain(id, { source: 'annotationKitExample' })
      const current = (): boolean => !disposed && !signal?.aborted && selectedSession(ctx) === id && ctx.sessions.binding(id) === binding
      try {
        if (!current()) throw new AnnotationError('error.sessionChangedAdd')
        // Reveal the selected conversation before locating its mounted Composer.
        ctx.layout.selectPanel(null)
        let handle = handles.get(id)
        for (let attempt = 0; handle === undefined && attempt < 50 && current(); attempt += 1) {
          await new Promise<void>(resolve => {
            const wake = (): void => { clearTimeout(timer); waiters.delete(wake); resolve() }
            const timer = setTimeout(wake, 100)
            waiters.add(wake)
          })
          handle = handles.get(id)
        }
        if (!current()) throw new AnnotationError('error.sessionChangedAdd')
        if (handle === undefined) throw new AnnotationError('error.composerNotReady')
        const composerHandle = handle
        const targetCurrent = (): boolean => current() && handles.get(id) === composerHandle
        if (!targetCurrent()) throw new AnnotationError('error.sessionChangedAdd')
        const factory = images.length > 0 ? draftFactory(ctx.conversation) : undefined
        const state = composerHandle.input()
        if (state.phase !== 'plain') throw new AnnotationError('error.composerBusy')
        const file = fileSelection ? fileReference(fileSelection) : undefined
        const response = responseSelection ? responseReference(responseSelection, t('response.title')) : undefined
        if (response) assertResponseCapacity(state, response.ref)
        if (file) assertFileDraftCapacity(state, file.ref)
        if (images.length > 0) {
          const limits = binding.session.projections.faceOf('imageLimits').getSnapshot() as ImageLimits | undefined
          if (limits === undefined) throw new AnnotationError('error.imageServiceNotReady')
          if (images.some(image => !limits.mediaTypes.includes(image.type))) throw new AnnotationError('error.imageFormat')
          const existing = factory!.resolveDraftAttachments(state.attachmentIds).filter(item => item.kind === 'image')
          if (existing.length + images.length > limits.maxImagesPerMessage
            || images.some(image => image.size > limits.maxImageBytes)
            || existing.reduce((total, item) => total + item.file.size, 0)
              + images.reduce((total, image) => total + image.size, 0) > limits.maxMessageImageBytes) {
            throw new AnnotationError('error.imageDraftLimit')
          }
        }
        if (page) await pageImages.save(page, images[0]!, signal)
        let packet: ReturnType<typeof packets.create> | undefined
        try {
          if (!targetCurrent()) throw new AnnotationError('error.sessionChangedAdd')
          const ids = factory === undefined ? [] : imageDrafts(factory, id, images)
          packet = annotations && factory ? packets.create(id, annotations, ids, factory,
            `${t('packet.title')} (${annotations.length})`) : undefined
          if (page && factory) pageImages.stage(id, page, images[0]!, factory, ids)
          const semanticReference = response ?? file ?? (packet ? packets.reference(packet) : undefined)
          commitToComposer(composerHandle.actions, text, ids, targetCurrent, attachmentId => factory?.releaseDraftAttachment(attachmentId),
            semanticReference ? span => ctx.sessions.scope(id)?.bail('slash/input-insert-reference', {
              reference: semanticReference, span: response ? { ...span, start: span.end } : span,
            }) === true : undefined)
          if (packet) packets.activate(packet)
          if (page) pageImages.activate(page.id)
        } catch (error) {
          if (packet) packets.discard(packet.id)
          if (page) await pageImages.cancel(page.id)
          throw error
        }
        if (focus) document.querySelector<HTMLElement>('[data-composer-card] [contenteditable="true"]')?.focus()
      } finally {
        reference.release()
      }
    },
    dispose() {
      if (disposed) return
      disposed = true
      packets.dispose()
      pageImages.dispose()
      packetUnsubscribe()
      listUnsubscribe()
      handles.clear()
      changed()
      listeners.clear()
      waiters.clear()
    },
  }

  // A callable facade must not advertise a missing version-bound admission API.
  // DocumentWorkflow captures this capability before the document UI is mounted.
  if (typeof Reflect.get(ctx.conversation, 'sendSession') !== 'function') delete bridge.sendPages

  type ConnectionProps = PropsRuntime<'conversation.input.overlay'> & PropsLocale<'annotations'> & { readonly sessionId: SessionId }
  function Connection({ sessionId, inputActions, useInput }: ConnectionProps) {
    const input = useInput(value => value)
    const packetRevision = useSyncExternalStore(packets.subscribe, packets.getSnapshot)
    const pageRevision = useSyncExternalStore(pageImages.subscribe, pageImages.getSnapshot)
    const mount = useRef<HTMLSpanElement>(null)
    useLayoutEffect(() => {
      const card = mount.current?.closest('[data-composer-card]')
      if (!card) return
      return bindReferencePresentation(card, input, (source, ref) => source === ANNOTATION_SOURCE
        ? !!packets.get(ref) : source === RESPONSE_SOURCE ? !!decodeResponseReference(ref) : source === FILE_SELECTION_SOURCE && !!decodeFileReference(ref))
    }, [input, packetRevision])
    useEffect(() => {
      const handle: ComposerHandle = {
        actions: inputActions,
        input: () => input,
      }
      handles.set(sessionId, handle)
      changed()
      return () => {
        if (handles.get(sessionId) === handle) handles.delete(sessionId)
        changed()
      }
    }, [sessionId, inputActions, input])
    useEffect(() => { packets.reconcile(sessionId, input, inputActions) }, [sessionId, input, inputActions, packetRevision])
    useEffect(() => { pageImages.reconcile(sessionId, input, inputActions, draftFactory(ctx.conversation)) }, [sessionId, input, inputActions, pageRevision])
    return <span ref={mount} hidden />
  }

  // The pinned upstream renderer continues to own ordinary attachments, drops
  // and upload retries. Only screenshots carried by an active annotation chip
  // are presented inside that chip's preview instead of as a second rail item.
  function Attachments(props: ComposerAttachmentsProps) {
    const input = props.useInput(value => value)
    useSyncExternalStore(packets.subscribe, packets.getSnapshot)
    useSyncExternalStore(pageImages.subscribe, pageImages.getSnapshot)
    // The overlay registers its actions after the attachment slot first mounts.
    useSyncExternalStore(bridge.subscribe, () => bridgeRevision)
    const grouped = new Set([...packets.imageIdsFor(input), ...pageImages.imageIdsFor(input)])
    const id = props.sessionId
    const handle = id ? handles.get(id) : undefined
    const files = input ? selectedFiles(input) : []
    const removeFile = (index: number): void => {
      const file = files[index]
      if (file && handle && input?.phase === 'plain') handle.actions.insertText('', { ...file.span, draftRev: handle.actions.captureInsertion().draftRev })
    }
    return <>
      {id && input && <ResponseCard key={`responses:${id}`} draft items={responseSelections(input).map(item => item.snapshot)} t={t}
        onOpen={(snapshot, edit, trigger) => responses.open?.(snapshot, edit, trigger)}
        onRemove={input.phase === 'plain' ? snapshot => responses.remove(id, snapshot.id) : undefined}
        onClear={input.phase === 'plain' ? () => responses.clear(id) : undefined} />}
      {id && handle && input && <PacketPreview packets={packets} sessionId={id} input={input} actions={handle.actions}
        t={t} editAnnotation={(entry, commit) => bridge.editAnnotation?.(entry, commit) ?? false} />}
      <SelectionCard key={id} draft items={files.map(file => file.snapshot)} t={t} onOpen={openFile}
        renderImage={snapshot => {
          const image = pageImages.preview(snapshot)
          return image?.url && !image.error ? <img src={image.url} alt={t('page.region')} style={{ maxWidth: '100%', maxHeight: 240, objectFit: 'contain' }} />
            : <span role={image?.error ? 'alert' : 'status'}>{image?.error ? annotationErrorText(image.error, t) : t('page.restoring')}</span>
        }}
        onRemove={handle && input?.phase === 'plain' ? removeFile : undefined}
        onClear={handle && input?.phase === 'plain' ? () => { for (let index = files.length - 1; index >= 0; index--) removeFile(index) } : undefined} />
      <ComposerAttachments {...props} attachments={props.attachments.filter(item => !grouped.has(item.id))} />
    </>
  }

  ctx.effect(() => ctx.slots.inject('conversation.input.overlay', () => ctx.slots.register({
    name: 'conversation.input.overlay', id: 'annotation-kit-composer-connection', order: 90, locale: 'annotations',
    inject: (sessionId): Pick<ConnectionProps, 'sessionId'> => ({ sessionId }),
  }, Connection)), 'annotation-kit: composer connection')
  ctx.effect(() => ctx.slots.inject('conversation.input.attachments', () => ctx.slots.register({
    name: 'conversation.input.attachments', priority: -10, locale: 'conversation',
  }, Attachments)), 'annotation-kit: grouped attachments')
  ctx.effect(() => () => bridge.dispose(), 'annotation-kit: composer cleanup')
  return bridge
}
