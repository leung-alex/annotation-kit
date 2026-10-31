import { AnnotationError } from '../../errors.ts'
/** Binary draft snapshots live in IndexedDB, never in prompt text or Lexical JSON. */
export interface PageImageStore {
  put(key: string, file: File): Promise<void>
  get(key: string, name: string): Promise<File | undefined>
  remove(key: string): Promise<void>
}

export function pageImageStore(databaseName = 'annotation-kit-page-selections'): PageImageStore {
  let opening: Promise<IDBDatabase> | undefined
  const open = () => opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1)
    request.onupgradeneeded = () => { request.result.createObjectStore('images', { keyPath: 'key' }) }
    request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); opening = undefined }; resolve(request.result) }
    request.onerror = () => { opening = undefined; reject(new AnnotationError('error.storeOpen', { cause: request.error })) }
  })
  async function transaction<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await open()
    return new Promise((resolve, reject) => {
      const tx = db.transaction('images', mode), request = run(tx.objectStore('images'))
      tx.oncomplete = () => resolve(request.result)
      tx.onabort = () => reject(new AnnotationError('error.storeWrite', { cause: tx.error }))
      tx.onerror = () => reject(new AnnotationError('error.storeWrite', { cause: tx.error }))
    })
  }
  return {
    async put(key, file) {
      await transaction('readwrite', store => store.put({ key, blob: file }))
    },
    async get(key, name) {
      const row: unknown = await transaction('readonly', store => store.get(key))
      if (!row || typeof row !== 'object' || !('blob' in row) || !(row.blob instanceof Blob)
        || row.blob.type !== 'image/png' || row.blob.size > 8 * 1024 * 1024) return undefined
      return new File([row.blob], name, { type: 'image/png' })
    },
    async remove(key) { await transaction('readwrite', store => store.delete(key)) },
  }
}
