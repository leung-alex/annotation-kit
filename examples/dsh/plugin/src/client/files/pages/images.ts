import { PageImages as Images, type PageImageStore } from 'annotation-kit'
import { pageImageStore } from './image-store.ts'
export class PageImages extends Images {
  constructor(store: PageImageStore = pageImageStore()) { super(store) }
}
