/**
 * Pipeline orchestrator: one vision-extraction call, then the deterministic
 * rule engine. Kept separate from the route handler so it can be reused
 * (CLI, batch workers) without HTTP.
 */

import { extractLabel, extractionModel, type ExtractionInput } from "./extract"
import { runRules } from "./rules"
import type { ApplicationData, VerificationResult } from "./types"

export async function verifyLabel(
  application: ApplicationData,
  image: ExtractionInput
): Promise<VerificationResult> {
  const startedAt = Date.now()
  const extraction = await extractLabel(image)
  const extractionMs = Date.now() - startedAt

  const { overall, fields } = runRules(application, extraction)

  return {
    overall,
    fields,
    extraction,
    extractionMs,
    model: extractionModel(),
  }
}
