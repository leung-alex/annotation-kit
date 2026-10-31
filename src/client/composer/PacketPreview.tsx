import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Chat, EditPencil, Trash, X } from '../../ui/icons.tsx'
import type { PropsLocale } from '../../host-contracts.ts'
import type { InputActions, InputState } from '../../host-contracts.ts'
import type { SessionId } from '../../host-contracts.ts'
import { AnnotationPackets, ANNOTATION_SOURCE, packetSpan, type AnnotationEntry } from './packets.ts'
import css from './PacketPreview.module.css'

export function PacketPreview({ packets, sessionId, input, actions, t, editAnnotation }: PropsLocale<'annotations'> & {
  packets: AnnotationPackets
  sessionId: SessionId
  input: InputState
  actions: InputActions
  editAnnotation: (entry: AnnotationEntry, commit: (comment: string) => void) => boolean
}) {
  useSyncExternalStore(packets.subscribe, packets.getSnapshot)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<string>()
  const [comment, setComment] = useState('')
  const host = useRef<HTMLDivElement>(null)
  const active = [...new Set(input.occurrences.filter(item => item.source === ANNOTATION_SOURCE).map(item => item.ref))]
    .flatMap(id => { const packet = packets.get(id); return packet?.sessionId === sessionId ? [packet] : [] })
  const count = active.reduce((sum, packet) => sum + packet.entries.length, 0)
  const editable = input.phase === 'plain'
  useEffect(() => { if (packets.opened?.sessionId === sessionId) setOpen(true) }, [packets.opened, sessionId])
  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !host.current?.contains(event.target)) setOpen(false) }
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    window.addEventListener('pointerdown', outside)
    window.addEventListener('keydown', escape)
    return () => { window.removeEventListener('pointerdown', outside); window.removeEventListener('keydown', escape) }
  }, [open])
  if (!count) return null
  const label = `${count} ${count === 1 ? t('packet.one') : t('packet.many')}`
  // The current flow creates one packet per comment, preserving editor undo.
  const remove = (id: string) => { const span = packetSpan(input, id); if (span) actions.insertText('', span) }
  return <div ref={host} className={css.host} data-aione-annotation-package>
    <div className={css.chip}>
      <button type="button" className={css.open} aria-expanded={open} aria-label={label} onClick={() => setOpen(value => !value)}>
        <Chat width={16} height={16} /><span>{label}</span>
      </button>
      <button type="button" className={css.removeAll} aria-label={t('packet.removeAll')} disabled={!editable}
        onClick={() => {
          for (const packet of [...active].reverse()) {
            const span = packetSpan(input, packet.id)
            if (span) actions.insertText('', { ...span, draftRev: actions.captureInsertion().draftRev })
          }
        }}><X width={14} height={14} /></button>
    </div>
    {open && <section className={css.packet} data-aione-annotation-packet aria-label={t('packet.title')}>
      {active.flatMap(packet => packet.entries.map((entry, index) => <article key={`${packet.id}:${entry.id}`} className={css.entry}>
        <div className={css.heading}>
          <button type="button" className={css.thumbnail} title={t('packet.screenshot')}
            onClick={() => { setEditing(editing === `image:${packet.id}` ? undefined : `image:${packet.id}`) }}>
            <img src={packet.previews[index]} alt={`${t('packet.screenshot')} #${entry.id}`} />
          </button>
          <code title={entry.selection.selector ?? entry.selection.url}>{entry.selection.element?.role ?? entry.selection.element?.tagName ?? entry.selection.kind}</code>
          <span className={css.spacer} />
          <button type="button" className={css.icon} aria-label={t('packet.edit')} disabled={!editable}
            onClick={() => {
              if (editAnnotation(entry, value => packets.edit(packet.id, index, value))) { setOpen(false); return }
              setEditing(packet.id); setComment(entry.comment)
            }}><EditPencil width={18} height={18} /></button>
          <button type="button" className={css.icon} aria-label={t('packet.remove')} disabled={!editable}
            onClick={() => remove(packet.id)}><Trash width={18} height={18} /></button>
        </div>
        {editing === `image:${packet.id}` && <img className={css.image} src={packet.previews[index]} alt={t('packet.screenshot')} />}
        {editing === packet.id ? <form onSubmit={event => {
          event.preventDefault(); packets.edit(packet.id, index, comment); setEditing(undefined)
        }}>
          <textarea autoFocus aria-label={t('comment')} value={comment} onChange={event => setComment(event.currentTarget.value)} />
          <div className={css.actions}><button type="button" onClick={() => setEditing(undefined)}>{t('cancel')}</button>
            <button type="submit" disabled={!comment.trim()}>{t('packet.done')}</button></div>
        </form> : <p className={css.text}>{entry.comment}</p>}
      </article>))}
      <button type="button" className={css.dismiss} aria-label={t('packet.done')} onClick={() => setOpen(false)}><X width={16} height={16} /></button>
    </section>}
  </div>
}
