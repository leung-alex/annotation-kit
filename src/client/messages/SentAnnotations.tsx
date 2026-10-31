import { useState } from 'react'
import { Chat } from '../../ui/icons.tsx'
import type { ReactNode } from 'react'
import type { PropsLocale } from '../../host-contracts.ts'
import { readAnnotation } from './presentation.ts'
import css from './SentAnnotations.module.css'
import { readSentFile, type FileSnapshot } from '../files/references.ts'
import { SelectionCard } from '../files/SelectionCard.tsx'
import { readSentResponse, type ResponseAnnotationSnapshot } from '../responses/references.ts'
import { ResponseCard } from '../responses/ResponseCard.tsx'

export interface SentAnnotationsProps<C, A> extends PropsLocale<'annotations'> {
  content: readonly C[]
  attachments: readonly A[]
  fallback: ReactNode
  renderDefault(content: readonly C[], attachments: readonly A[]): ReactNode
  renderText(text: string): ReactNode
  imageName(attachment: A): string | undefined
  renderImage(attachment: A): ReactNode
  openFile?: (snapshot: FileSnapshot) => void | Promise<void>
  openResponse?: (snapshot: ResponseAnnotationSnapshot) => void | Promise<void>
}

/** Annotation metadata is a display hint, never HTML, a URL to fetch, or model instructions. */
export function SentAnnotations<C, A>({ content, attachments, fallback, renderDefault, renderImage, renderText, imageName, t, openFile, openResponse }: SentAnnotationsProps<C, A>) {
  const [expanded, setExpanded] = useState(false)
  const packets = content.flatMap(block => { const packet = readAnnotation(block); return packet ? [packet] : [] })
  const files = content.flatMap(block => { const snapshot = readSentFile(block); return snapshot ? [snapshot] : [] })
  const responses = content.flatMap(block => { const snapshot = readSentResponse(block); return snapshot ? [snapshot] : [] })
  if (packets.length === 0 && files.length === 0 && responses.length === 0) return fallback
  const entries = packets.flatMap(packet => packet.presentation.data.entries)
  const owned = new Set<A>()
  const rows = entries.map(entry => {
    const matching = attachments.filter(attachment => imageName(attachment) === entry.screenshot)
    // Never conceal an ambiguous ordinary attachment with the same filename.
    const image = matching.length === 1 ? matching[0] : undefined
    if (image) owned.add(image)
    return { entry, image }
  })
  const fileImages = new Map<string, A>()
  for (const snapshot of files) {
    if (snapshot.version !== 2 || !snapshot.image) continue
    const matching = attachments.filter(attachment => imageName(attachment) === snapshot.image!.name)
    const image = matching.length === 1 ? matching[0] : undefined
    if (image) { owned.add(image); fileImages.set(snapshot.id, image) }
  }
  const remaining = content.filter(block => !readAnnotation(block) && !readSentFile(block) && !readSentResponse(block))
    .filter(block => !(typeof block === 'object' && block !== null && 'type' in block && block.type === 'text'
      && 'text' in block && typeof block.text === 'string' && !block.text.trim()))
  const ordinaryAttachments = attachments.filter(attachment => !owned.has(attachment))
  return <>
    {renderDefault(remaining, ordinaryAttachments)}
    <ResponseCard items={responses} t={t} onOpen={openResponse} renderText={renderText} />
    <SelectionCard items={files} t={t} onOpen={openFile} renderText={renderText} renderImage={snapshot => {
      const image = fileImages.get(snapshot.id)
      return image ? renderImage(image) : <span>{t('page.imageMissing')}</span>
    }} />
    {packets.length > 0 && <section className={css.card} data-annotation-message>
      <button type="button" className={css.summary} aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
        <Chat width={18} height={18} />
        <span>{entries.length} {entries.length === 1 ? t('packet.one') : t('packet.many')}</span>
        <span className={css.toggle}>{expanded ? t('message.collapse') : t('message.expand')}</span>
      </button>
      {rows.map(({ entry, image }, index) => <div className={css.entry} key={index}>
        <div className={css.context}><span className={css.number}>{index + 1}</span><span>{renderText(entry.title || entry.url)}</span></div>
        <p className={css.comment} data-expanded={expanded || undefined}>{renderText(entry.comment || t('packet.title'))}</p>
        {expanded && <div className={css.detail}>
          <span className={css.url}>{renderText(entry.url)}</span>
          <code>{renderText(entry.target)}</code>
          {image && renderImage(image)}
        </div>}
      </div>)}
      {expanded && <details className={css.evidence}>
        <summary>{t('message.evidence')}</summary>
        <pre>{renderText(packets.map(packet => packet.text).join('\n\n'))}</pre>
      </details>}
    </section>}
  </>
}
