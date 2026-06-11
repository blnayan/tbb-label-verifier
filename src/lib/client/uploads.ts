/**
 * In-flight uploads: labels submitted for verification whose result hasn't
 * arrived yet. The Verifications page shows these under "Verifying".
 *
 * Deliberately in-memory, not IndexedDB: a page reload aborts the actual
 * HTTP request, so a persisted "verifying" row would spin forever. Module
 * state survives client-side navigation (which is when the list matters)
 * and dies with the requests it describes.
 */

import type { ApplicationData } from "@/lib/verification/types"

export interface InFlightUpload {
  id: string
  /** Epoch milliseconds when the upload was submitted. */
  createdAt: number
  source: "single" | "batch"
  filename: string
  application: ApplicationData
}

const inFlight = new Map<string, InFlightUpload>()
const listeners = new Set<() => void>()

function notify() {
  for (const listener of listeners) listener()
}

/** Register a submitted upload; returns the id to pass to finishUpload. */
export function startUpload(
  upload: Omit<InFlightUpload, "id" | "createdAt">
): string {
  const id = crypto.randomUUID()
  inFlight.set(id, { ...upload, id, createdAt: Date.now() })
  notify()
  return id
}

/** Remove an upload once its verification settled (saved or errored). */
export function finishUpload(id: string): void {
  if (inFlight.delete(id)) notify()
}

/** Uploads still being verified, newest first. */
export function listInFlight(): InFlightUpload[] {
  // Map preserves insertion order; newest first is just a reverse.
  return [...inFlight.values()].reverse()
}

export function subscribeToUploads(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
