import { PageBatches as Batches, type PageImageStore } from 'annotation-kit'
import { pageImageStore } from './image-store.ts'
export class PageBatches extends Batches {
  constructor(images: PageImageStore = pageImageStore(), storage: () => Storage = () => localStorage) {
    super(images, storage, 'annotation-kit.dsh.document-annotations.v1')
  }
}
