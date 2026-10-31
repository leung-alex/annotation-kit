import { sheetRecoveryComponent as createRecovery } from 'annotation-kit/react'
import type { DocumentAnnotationBridge } from 'annotation-kit'
import { PageBatches } from '../pages/batches.ts'
import { withAnnotationUi } from '../../annotation-ui.tsx'
export { failedSheetPreview } from 'annotation-kit/react'
export function sheetRecoveryComponent(bridge: DocumentAnnotationBridge, batches: PageBatches) {
  return withAnnotationUi(createRecovery(bridge, batches))
}
