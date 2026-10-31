import { useState, type ReactNode } from 'react'
import { X } from '../../ui/icons.tsx'
import { ReferenceCard } from '../composer/ReferenceCard.tsx'
import type { PropsLocale } from '../../host-contracts.ts'
import { fileLabel, filePath, type FileSnapshot } from './references.ts'
import { columnName } from './sheets/snapshot.ts'
import css from './SelectionCard.module.css'

export function SelectionCard({ items, draft = false, initiallyOpen = false, onRemove, onClear, onOpen, renderImage, renderText = text => text, t }: PropsLocale<'annotations'> & {
  items: readonly FileSnapshot[]
  draft?: boolean
  initiallyOpen?: boolean
  onRemove?: (index: number) => void
  onClear?: () => void
  onOpen?: (item: FileSnapshot) => void | Promise<void>
  renderImage?: (item: FileSnapshot) => ReactNode
  renderText?: (text: string) => ReactNode
}) {
  const [openFailed, setOpenFailed] = useState(false)
  if (!items.length) return null
  const annotated = items.every(item => item.version !== 1 && item.comment)
  const label = `${items.length} ${annotated ? (items.length === 1 ? t('page.one') : t('page.many')) : (items.length === 1 ? t('file.one') : t('file.many'))}`
  return <ReferenceCard kind="file" draft={draft} initiallyOpen={initiallyOpen} label={label} onClear={onClear} clearLabel={t('file.removeAll')}>
    {() => <>
      {items.map((item, index) => <article className={css.entry} key={`${item.id}:${index}`}>
        <div className={css.heading}>
          {onOpen ? <button type="button" className={css.source} title={`${t('file.openSource')}: ${filePath(item)}`}
            onClick={async () => {
              try { await onOpen(item); setOpenFailed(false) } catch { setOpenFailed(true) }
            }}>{fileLabel(item)}</button> : <span className={css.source} title={filePath(item)}>{fileLabel(item)}</span>}
          {onRemove && <button type="button" className={css.remove} aria-label={`${t('file.remove')} ${index + 1}`}
            onClick={() => onRemove(index)}><X width={14} height={14} /></button>}
        </div>
        {item.kind === 'markdown' && <span className={css.hint}>{t('file.sourceBlock')}</span>}
        {item.version !== 1 && item.comment && <p className={css.quote}>{renderText(item.comment)}</p>}
        {item.version === 3 ? <div className={css.tableScroll}><table className={css.cells} aria-label={item.a1}>
          <thead><tr><th>{t('sheet.cell')}</th><th>{t('sheet.value')}</th>{item.cells.some(cell => cell.formula) && <th>{t('sheet.formula')}</th>}</tr></thead>
          <tbody>{item.cells.map(cell => <tr key={`${cell.row}:${cell.column}`}>
            <td>{columnName(cell.column)}{cell.row + 1}</td><td title={draft ? `${t('sheet.raw')}: ${JSON.stringify(cell.raw)}${cell.format ? ` (${cell.format})` : ''}` : undefined}>
              {cell.display ? renderText(cell.display) : <span className={css.hint}>{t('sheet.empty')}</span>}
              {cell.raw !== null && String(cell.raw) !== cell.display && <small>{t('sheet.raw')}: {renderText(String(cell.raw))}</small>}
            </td>{item.cells.some(value => value.formula) && <td>{cell.formula && renderText(cell.formula)}</td>}
          </tr>)}</tbody>
        </table></div> : item.text && <blockquote className={css.quote}>{renderText(item.text)}</blockquote>}
        {item.version === 2 && item.image && renderImage?.(item)}
      </article>)}
      {openFailed && <p role="alert" className={css.hint}>{t('file.openFailed')}</p>}
    </>}
  </ReferenceCard>
}
