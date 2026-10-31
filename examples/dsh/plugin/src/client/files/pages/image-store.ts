import { pageImageStore as createStore } from 'annotation-kit'
export type { PageImageStore } from 'annotation-kit'
export function pageImageStore() { return createStore('annotation-kit-dsh-page-selections') }
