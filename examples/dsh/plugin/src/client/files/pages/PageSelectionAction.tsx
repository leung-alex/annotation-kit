import { pageActionComponent as createAction } from 'annotation-kit/react'
import type { DocumentAnnotationBridge } from 'annotation-kit'
import { PageBatches } from './batches.ts'
import { withAnnotationUi } from '../../annotation-ui.tsx'
export function pageActionComponent(bridge: DocumentAnnotationBridge, batches = new PageBatches()) {
  return withAnnotationUi(createAction(bridge, batches))
}
