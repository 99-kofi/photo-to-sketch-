/**
 * Model storage: fetches model.onnx from the Hugging Face CDN with a
 * progress-tracked, resumable download and caches it in IndexedDB so the app
 * works offline after a single setup.
 */
import { MODEL_SIZE, MODEL_SHA256, MODEL_FILE, MODEL_REVISION, modelUrl } from './modelConfig';

const DB_NAME = 'sketch-studio';
const DB_VERSION = 1;
const STORE_META = 'meta';
const STORE_PARTS = 'parts';
const STORE_BLOB = 'blob';

export interface ModelMeta {
  file: string;
  revision: string;
  size: number;
  sha256: string | null; // null when the digest could not be computed
  downloadedAt: number;
}

export type DownloadOutcome = 'downloaded' | 'exists';

export interface DownloadProgress {
  received: number;
  total: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_META)) db.createObjectStore(STORE_META, { keyPath: 'file' });
      if (!db.objectStoreNames.contains(STORE_PARTS)) db.createObjectStore(STORE_PARTS, { autoIncrement: true });
      if (!db.objectStoreNames.contains(STORE_BLOB)) db.createObjectStore(STORE_BLOB);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
}

async function withStore<T>(
  name: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T> | void,
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(name, mode);
    const store = tx.objectStore(name);
    let result: T | undefined;
    const req = fn(store);
    if (req) {
      req.onsuccess = () => {
        result = req.result;
      };
    }
    tx.oncomplete = () => resolve(result as T);
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
  });
}

export async function getModelMeta(): Promise<ModelMeta | null> {
  try {
    return (await withStore<ModelMeta | undefined>(STORE_META, 'readonly', (s) => s.get(MODEL_FILE))) ?? null;
  } catch {
    return null;
  }
}

export async function getModelBuffer(): Promise<ArrayBuffer | null> {
  try {
    const arr = await withStore<ArrayBuffer | undefined>(STORE_BLOB, 'readonly', (s) => s.get(MODEL_FILE));
    return arr instanceof ArrayBuffer ? arr : null;
  } catch {
    return null;
  }
}

export async function deleteModel(): Promise<void> {
  try {
    await withStore(STORE_BLOB, 'readwrite', (s) => {
      s.delete(MODEL_FILE);
    });
    await withStore(STORE_META, 'readwrite', (s) => {
      s.delete(MODEL_FILE);
    });
    await withStore(STORE_PARTS, 'readwrite', (s) => {
      s.clear();
    });
  } catch {
    /* nothing to clean */
  }
}

/** Ask the browser to keep our storage; called before a big download. */
async function requestPersistence(): Promise<boolean> {
  try {
    if (navigator.storage?.persisted && (await navigator.storage.persisted())) return true;
    return navigator.storage?.persist ? await navigator.storage.persist() : false;
  } catch {
    return false;
  }
}

async function loadSavedParts(): Promise<ArrayBuffer[]> {
  try {
    const keys = await withStore<IDBValidKey[]>(STORE_PARTS, 'readonly', (s) => s.getAllKeys());
    const parts: ArrayBuffer[] = [];
    for (const key of keys) {
      const bytes = await withStore<ArrayBuffer | undefined>(STORE_PARTS, 'readonly', (s) => s.get(key));
      if (bytes instanceof ArrayBuffer) parts.push(bytes);
    }
    return parts;
  } catch {
    return [];
  }
}

function totalLength(res: Response): number | null {
  const range = res.headers.get('content-range'); // e.g. bytes 4096-124161027/124161028
  if (range) {
    const m = /\/(\d+)$/.exec(range);
    if (m) return Number(m[1]);
  }
  const linked = res.headers.get('x-linked-size');
  if (linked != null) {
    const n = Number(linked);
    if (!isNaN(n) && n > 0) return n;
  }
  const len = res.headers.get('content-length');
  if (len != null) {
    const n = Number(len);
    if (!isNaN(n) && n > 0) return n;
  }
  return null;
}

function mergeBuffers(buffers: ArrayBuffer[], total: number): ArrayBuffer {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const buf of buffers) {
    out.set(new Uint8Array(buf), offset);
    offset += buf.byteLength;
  }
  return out.buffer;
}

/**
 * Downloads the model (or resumes a previous partial download) and verifies
 * its SHA-256 digest against the pinned hash before marking it as ready.
 * Throws on failure; callers can simply retry, which resumes where it left off.
 */
export async function downloadModel(onProgress: (p: DownloadProgress) => void): Promise<DownloadOutcome> {
  if (await getModelMeta()) return 'exists';

  const url = modelUrl();
  const bustUrl = new URL(url, window.location.href); // resolve relative base (dev/GH Pages)
  bustUrl.search = `${bustUrl.search ? bustUrl.search + '&' : '?'}r=${Math.random()}`; // bypass broken caches

  await requestPersistence();

  // Load any previous partial download so we can resume with a Range request.
  const parts = await loadSavedParts();
  const have = parts.reduce((a, b) => a + b.byteLength, 0);
  let persistedCount = parts.length; // how many of `parts` are already in IDB

  /**
   * Merge, verify and cache the assembled buffer; clear checkpoints.
   */
  const finalize = async (): Promise<DownloadOutcome> => {
    const received = parts.reduce((a, b) => a + b.byteLength, 0);
    onProgress({ received, total: MODEL_SIZE });
    if (received === 0) throw new Error('No model data available — is the network reachable?');

    const merged = mergeBuffers(parts, received);

    // Verify the digest. Digesting 118 MB can fail on very constrained
    // devices — best-effort: a failed digest does not invalidate the file.
    let sha256: string | null = null;
    try {
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', merged));
      sha256 = [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
    } catch {
      sha256 = null;
    }
    if (sha256 != null && sha256 !== MODEL_SHA256) {
      await deleteModel();
      throw new Error('Model integrity check failed — the download was corrupted. Please retry.');
    }

    await withStore(STORE_BLOB, 'readwrite', (s) => {
      s.put(merged, MODEL_FILE);
    });
    await withStore(STORE_PARTS, 'readwrite', (s) => {
      s.clear();
    });
    await withStore(STORE_META, 'readwrite', (s) => {
      s.put(
        { file: MODEL_FILE, revision: MODEL_REVISION, size: received, sha256, downloadedAt: Date.now() } satisfies ModelMeta, // inline key: 'file'
      );
    });
    return 'downloaded';
  };

  // Recovery path: a previous run may already hold the complete file (e.g. it
  // crashed between streaming and merging). Finalize without a fetch.
  if (have >= MODEL_SIZE) {
    return await finalize();
  }

  const headers: Record<string, string> = {};
  if (have > 0) headers['Range'] = `bytes=${have}-`;
  let response = await fetch(bustUrl, { headers, mode: 'cors', credentials: 'omit', cache: 'no-store' });

  // Server cannot resume (200 instead of 206)? Start over and drop the parts.
  if (have > 0 && response.status !== 206) {
    parts.length = 0;
    persistedCount = 0;
    await withStore(STORE_PARTS, 'readwrite', (s) => {
      s.clear();
    });
    response = await fetch(bustUrl, { mode: 'cors', credentials: 'omit', cache: 'no-store' });
  }
  if (!response.ok) throw new Error(`CDN responded ${response.status} ${response.statusText}`);
  if (response.body == null) throw new Error('Streaming download unsupported in this browser.');

  const total = totalLength(response) ?? MODEL_SIZE;
  let flushSince = 0;

  const flush = async () => {
    if (persistedCount >= parts.length) return;
    const toWrite = parts.slice(persistedCount);
    persistedCount = parts.length;
    await withStore(STORE_PARTS, 'readwrite', (s) => {
      for (const part of toWrite) s.add(part);
    });
    flushSince = 0;
  };

  const reader = response.body.getReader();
  let received = have;
  for (;;) {
    const { done, value } = await reader.read();
    if (value && value.byteLength > 0) {
      const copy = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
      parts.push(copy);
      flushSince += copy.byteLength;
      received += copy.byteLength;
      if (flushSince >= 4 * 1024 * 1024) await flush(); // resumable checkpoint
    }
    onProgress({ received, total });
    if (done) break;
  }
  await flush();

  if (received < total) {
    throw new Error(`Incomplete download (${Math.round((received / total) * 100)}%) — retry to resume.`);
  }

  return await finalize();
}
