/**
 * Verification history, persisted client-side in IndexedDB.
 *
 * Every completed verification (single or batch) is saved here and worked
 * from the Review page. Records carry the downscaled image blob that was
 * actually verified, so the report always shows the exact pixels the model
 * saw.
 *
 * Each record also carries a review state. The deterministic rules settle
 * the clear-cut cases on their own: "pass" is approved automatically and
 * "fail" rejected automatically. Only genuine ambiguity — close matches and
 * unreadable images — waits in the review queue for a manual approve/reject
 * decision. Every decision, auto or manual, can be revisited and changed.
 *
 * The store's primary key is an auto-incremented sequence number, which makes
 * insertion order the chronological order — listing newest-first is just a
 * reverse, with no same-millisecond timestamp ties to worry about. A unique
 * index on the record id supports review updates.
 */

import type {
  ApplicationData,
  VerificationResult,
} from "@/lib/verification/types"

export type ReviewDecision = "approved" | "rejected"

export type ReviewState =
  | { state: "pending"; mode: null; reviewedAt: null }
  | { state: ReviewDecision; mode: "auto" | "manual"; reviewedAt: number }

export interface VerificationRecord {
  /** Stable identifier for the record (UUID). */
  id: string
  /** Epoch milliseconds when the verification was saved. */
  createdAt: number
  /** Which workflow produced it. */
  source: "single" | "batch"
  /** Name of the uploaded image file. */
  filename: string
  application: ApplicationData
  result: VerificationResult
  /** The downscaled image that was sent for verification. */
  image: Blob
  /** Auto-approved on pass; otherwise pending until manually reviewed. */
  review: ReviewState
}

export type NewVerificationRecord = Omit<
  VerificationRecord,
  "id" | "createdAt" | "review"
>

const DB_NAME = "ttb-label-verifier"
const DB_VERSION = 3
const STORE = "verifications"
const ID_INDEX = "id"
const CHANNEL_NAME = "ttb-verifications-changed"

/**
 * Change notifications, so the Verifications page updates live instead of
 * needing a reload. Local listeners cover this tab; a BroadcastChannel
 * relays writes to other tabs (the channel never echoes to its sender, so
 * nothing fires twice).
 */
const listeners = new Set<() => void>()
let channel: BroadcastChannel | null = null

function getChannel(): BroadcastChannel | null {
  if (channel === null && typeof BroadcastChannel !== "undefined") {
    channel = new BroadcastChannel(CHANNEL_NAME)
    // Node exposes unref(); without it an open channel keeps the test
    // process alive. A no-op in browsers.
    ;(channel as { unref?: () => void }).unref?.()
    channel.onmessage = () => {
      for (const listener of listeners) listener()
    }
  }
  return channel
}

function notifyChange() {
  for (const listener of listeners) listener()
  getChannel()?.postMessage("changed")
}

/** Be told whenever the stored verifications change (any tab). */
export function subscribeToVerifications(listener: () => void): () => void {
  listeners.add(listener)
  getChannel()
  return () => {
    listeners.delete(listener)
  }
}

/** The review state a verification starts in, from its rule verdict. */
function initialReview(result: VerificationResult): ReviewState {
  switch (result.overall) {
    case "pass":
      return { state: "approved", mode: "auto", reviewedAt: Date.now() }
    case "fail":
      return { state: "rejected", mode: "auto", reviewedAt: Date.now() }
    default:
      return { state: "pending", mode: null, reviewedAt: null }
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      const store = db.objectStoreNames.contains(STORE)
        ? request.transaction!.objectStore(STORE)
        : db.createObjectStore(STORE, { keyPath: "seq", autoIncrement: true })
      if (!store.indexNames.contains(ID_INDEX)) {
        store.createIndex(ID_INDEX, "id", { unique: true })
      }
      store.openCursor().onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result
        if (!cursor) return
        const record = cursor.value
        if (!record.review) {
          // v1 records predate review states — derive from the verdict.
          cursor.update({ ...record, review: initialReview(record.result) })
        } else if (
          record.review.state === "pending" &&
          record.result.overall === "fail"
        ) {
          // v2 queued fails for manual review; v3 auto-rejects them. Manual
          // decisions are never touched.
          cursor.update({ ...record, review: initialReview(record.result) })
        }
        cursor.continue()
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

/** Run one transaction against the store and close the connection after. */
async function withStore<T>(
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const db = await openDb()
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = work(db.transaction(STORE, mode).objectStore(STORE))
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  } finally {
    db.close()
  }
}

export async function saveVerification(
  record: NewVerificationRecord
): Promise<VerificationRecord> {
  const saved: VerificationRecord = {
    ...record,
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    review: initialReview(record.result),
  }
  await withStore("readwrite", (store) => store.add(saved))
  notifyChange()
  return saved
}

/** One verification by record id, or null if it (no longer) exists. */
export async function getVerification(
  id: string
): Promise<VerificationRecord | null> {
  const record = await withStore<VerificationRecord | undefined>(
    "readonly",
    (store) => store.index(ID_INDEX).get(id)
  )
  return record ?? null
}

/** All stored verifications, newest first. */
export async function listVerifications(): Promise<VerificationRecord[]> {
  const records = await withStore<VerificationRecord[]>("readonly", (store) =>
    store.getAll()
  )
  return records.reverse()
}

/** Record (or change) a manual review decision for one verification. */
export async function reviewVerification(
  id: string,
  decision: ReviewDecision
): Promise<VerificationRecord> {
  const db = await openDb()
  try {
    return await new Promise<VerificationRecord>((resolve, reject) => {
      const store = db.transaction(STORE, "readwrite").objectStore(STORE)
      const lookup = store.index(ID_INDEX).get(id)
      lookup.onsuccess = () => {
        const record = lookup.result as VerificationRecord | undefined
        if (!record) {
          reject(new Error(`No verification with id "${id}".`))
          return
        }
        const updated: VerificationRecord = {
          ...record,
          review: { state: decision, mode: "manual", reviewedAt: Date.now() },
        }
        const put = store.put(updated)
        put.onsuccess = () => {
          notifyChange()
          resolve(updated)
        }
        put.onerror = () => reject(put.error)
      }
      lookup.onerror = () => reject(lookup.error)
    })
  } finally {
    db.close()
  }
}

export async function clearVerifications(): Promise<void> {
  await withStore("readwrite", (store) => store.clear())
  notifyChange()
}
