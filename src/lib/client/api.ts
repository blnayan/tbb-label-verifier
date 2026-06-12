/**
 * Client wrapper for POST /api/verify.
 */

import type {
  ApplicationData,
  VerificationResult,
} from "@/lib/verification/types"

export class VerifyError extends Error {
  readonly retryable: boolean

  constructor(message: string, retryable = false) {
    super(message)
    this.retryable = retryable
  }
}

export async function verifyLabelRequest(
  application: ApplicationData,
  image: File
): Promise<VerificationResult> {
  const form = new FormData()
  form.set("brandName", application.brandName)
  form.set("classType", application.classType)
  form.set("alcoholPercent", String(application.alcoholPercent))
  form.set("netContents", application.netContents)
  form.set("bottlerNameAddress", application.bottlerNameAddress)
  if (application.countryOfOrigin) {
    form.set("countryOfOrigin", application.countryOfOrigin)
  }
  form.set("image", image)

  let response: Response
  try {
    response = await fetch("/api/verify", { method: "POST", body: form })
  } catch {
    throw new VerifyError(
      "Could not reach the server. Check your connection.",
      true
    )
  }

  const body = await response.json().catch(() => null)
  if (!response.ok) {
    const message =
      body && typeof body.error === "string"
        ? body.error
        : `Verification failed (HTTP ${response.status}).`
    throw new VerifyError(message, Boolean(body?.retryable))
  }
  if (!body || typeof body !== "object") {
    throw new VerifyError("The server returned an invalid response.", true)
  }
  return body as VerificationResult
}
