import { useEffect, useState, memo } from 'react'
import { Workbook } from '@fortune-sheet/react'
import fortuneCss from '@fortune-sheet/react/dist/index.css?inline'
import { SheetSurface as Surface } from 'annotation-kit/react'
import { withAnnotationUi } from '../../annotation-ui.tsx'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { parseFileAddress } from '@deepseek-ai/dsh-util-workspace-path'
import { Config } from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/src/config.ts'
import { parseExcel } from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/src/client/excel/parse.ts'
import { LazyExcelBody } from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/src/client/excel/LazyExcelBody.tsx'
import type { ExcelPreview } from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/src/client/excel/model.ts'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/src/client/excel/locales.ts'
import bodyCss from '@deepseek-ai/dsh-client-ui-sidebar-documentpreview/src/client/excel/ExcelBody.module.css'
import type { DocumentAnnotationBridge } from '../document-workflow.ts'
import { PageBatches } from '../pages/batches.ts'
const SheetSurface = withAnnotationUi(Surface)
type BodyProps = PropsRuntime<'sidebar.right.tab.document'> & PropsLocale<'sidebarExcel'>
type Translate = PropsLocale<'annotations'>['t']
const styles = `@scope ([data-excel-preview]) { ${fortuneCss} }`
// Overlay repaints must not refresh FortuneSheet settings or reinitialize its selection.
const StableWorkbook = memo(Workbook)

export function SheetToolbar({ absolutePath }: { absolutePath: string }) {
  return /\.(xlsx|csv)$/iu.test(absolutePath) ? <span data-sheet-annotation-toolbar /> : null
}

export function sheetBodyComponent(bridge: DocumentAnnotationBridge, at: Translate, batches = new PageBatches()) {
  const limits = Config((globalThis as { __DSH_DOCUMENT_PREVIEW_CONFIG__?: unknown }).__DSH_DOCUMENT_PREVIEW_CONFIG__ ?? {}).excel
  return function SheetBody(props: BodyProps) {
    const path = parseFileAddress(props.resourceAddress)?.path ?? ''
    const format = /\.xlsx$/iu.test(path) ? 'xlsx' : /\.csv$/iu.test(path) ? 'csv' : undefined
    if (!format) return <LazyExcelBody {...props} limits={limits} />
    return <ParsedSheet key={props.resourceAddress} {...props} format={format} bridge={bridge} at={at} batches={batches} limits={limits} />
  }
}

function ParsedSheet({ content, format, limits, ...props }: BodyProps & {
  format: 'xlsx' | 'csv'; limits: ReturnType<typeof Config>['excel']; bridge: DocumentAnnotationBridge; at: Translate; batches: PageBatches
}) {
  const bytes = content.kind === 'bytes' ? content.data : undefined
  const [state, setState] = useState<{ bytes: typeof bytes; value?: ExcelPreview; error?: string }>()
  const [attempt, retry] = useState(0)
  useEffect(() => {
    if (!bytes) return
    const abort = new AbortController()
    void parseExcel(bytes, format, limits, abort.signal).then(value => {
      if (!abort.signal.aborted) setState({ bytes, value })
    }, error => { if (!abort.signal.aborted) setState({ bytes, error: error instanceof Error ? error.message : 'invalid' }) })
    return () => abort.abort()
  }, [bytes, format, attempt])
  if (!bytes || state?.error && state.bytes === bytes) return <div className={bodyCss.status} role="alert" data-sheet-load-error>
    {props.t(state?.error === 'tooLarge' || state?.error === 'timeout' || state?.error === 'encoding' ? state.error : 'invalid')}
    <button type="button" onClick={() => { setState(undefined); retry(n => n + 1) }}>{props.t('retry')}</button>
  </div>
  if (!state?.value || state.bytes !== bytes) return <div className={bodyCss.status}>{props.t('loading')}</div>
  return <SheetSurface key={`${attempt}:${props.t('language')}`} {...props} format={format} value={state.value} Workbook={StableWorkbook} bodyCss={bodyCss} workbookCss={styles} />
}

