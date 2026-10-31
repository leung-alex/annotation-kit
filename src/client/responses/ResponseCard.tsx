import { useState, type ReactNode } from 'react'
import { Pencil, Trash } from '../../ui/icons.tsx'
import type { PropsLocale } from '../../host-contracts.ts'
import { ReferenceCard } from '../composer/ReferenceCard.tsx'
import { annotationErrorText, annotationFailure, type AnnotationFailure } from '../errors.ts'
import type { ResponseAnnotationSnapshot } from './references.ts'
import css from '../files/SelectionCard.module.css'

export function ResponseCard({ items, draft = false, t, onOpen, onRemove, onClear, renderText = text => text }: PropsLocale<'annotations'> & {
  readonly items: readonly ResponseAnnotationSnapshot[]
  readonly draft?: boolean
  readonly onOpen?: (snapshot: ResponseAnnotationSnapshot, edit: boolean, trigger?: HTMLElement) => void | Promise<void>
  readonly onRemove?: (snapshot: ResponseAnnotationSnapshot) => void
  readonly onClear?: () => void
  readonly renderText?: (text: string) => ReactNode
}) {
  const [failure, setFailure] = useState<AnnotationFailure>()
  const run = async (action: () => void | Promise<void>) => {
    try { await action(); setFailure(undefined) } catch (error) { setFailure(annotationFailure(error)) }
  }
  if (!items.length) return null
  return <ReferenceCard kind="response" draft={draft} label={`${items.length} ${t(items.length === 1 ? 'packet.one' : 'packet.many')}`}
    clearLabel={t('packet.removeAll')} onClear={onClear ? () => { void run(onClear) } : undefined}>
    {items.map((snapshot, index) => <article className={css.entry} key={`${snapshot.id}:${index}`}>
      <div className={css.heading}>
        {onOpen ? <button type="button" className={css.source} title={t('response.source')}
          onClick={event => { const trigger = event.currentTarget; void run(() => onOpen(snapshot, false, trigger)) }}>
          {index + 1}. {t('response.location')}
        </button> : <span className={css.source}>{index + 1}. {t('response.location')}</span>}
        {draft && onOpen && <button type="button" className={css.remove} aria-label={`${t('response.edit')} ${index + 1}`}
          onClick={event => { const trigger = event.currentTarget; void run(() => onOpen(snapshot, true, trigger)) }}><Pencil width={14} height={14} /></button>}
        {onRemove && <button type="button" className={css.remove} aria-label={`${t('page.delete')} ${index + 1}`}
          onClick={() => { void run(() => onRemove(snapshot)) }}><Trash width={14} height={14} /></button>}
      </div>
      <blockquote className={css.quote} aria-label={t('response.selected')}>{renderText(snapshot.text)}</blockquote>
      {snapshot.comment && <p className={css.quote}>{renderText(snapshot.comment)}</p>}
    </article>)}
    {failure && <p role="alert" className={css.hint}>{annotationErrorText(failure, t)}</p>}
  </ReferenceCard>
}
