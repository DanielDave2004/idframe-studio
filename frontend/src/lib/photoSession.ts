// Keep the active editing session across page reloads without uploading it.
// IndexedDB stores binary Blobs, avoiding sessionStorage's small string limits.
const DB_NAME = 'idframe-photo-session'
const STORE_NAME = 'photos'
const DB_VERSION = 1

type SavedPhoto = { blob: Blob; name: string }

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function access<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore, resolve: (value: T) => void) => void): Promise<T> {
  const db = await openDB()
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode)
    const store = transaction.objectStore(STORE_NAME)
    let value: T
    action(store, result => { value = result })
    transaction.oncomplete = () => { db.close(); resolve(value) }
    transaction.onerror = () => { db.close(); reject(transaction.error) }
    transaction.onabort = () => { db.close(); reject(transaction.error) }
  })
}

export function savePhoto(key: 'original' | 'generated', blob: Blob, name: string): Promise<void> {
  return access<void>('readwrite', (store, done) => { store.put({ blob, name }, key); done() })
}

export function loadPhoto(key: 'original' | 'generated'): Promise<SavedPhoto | null> {
  return access<SavedPhoto | null>('readonly', (store, done) => {
    const request = store.get(key)
    request.onsuccess = () => done((request.result as SavedPhoto | undefined) ?? null)
  })
}

export function clearPhotos(): Promise<void> {
  return access<void>('readwrite', (store, done) => { store.clear(); done() })
}

export function clearGenerated(): Promise<void> {
  return access<void>('readwrite', (store, done) => { store.delete('generated'); done() })
}
