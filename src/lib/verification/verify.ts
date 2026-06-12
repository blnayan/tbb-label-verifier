/**
 * Pipeline orchestrator: a blind vision-extraction call plus a parallel
 * blind re-read of the government warning, the deterministic rule engine,
 * and — only when a comparison field fails — one focused second read of
 * the disputed fields. Kept separate from the route handler so it can be
 * reused (CLI, batch workers) without HTTP.
 */

import {
  extractLabel,
  extractionModel,
  recheckDisputedFields,
  rereadWarning,
  type ExtractionInput,
} from "./extract"
import {
  applyRecheck,
  applyWarningChallenge,
  applyWarningStability,
  rollUpOverall,
  runRules,
} from "./rules"
import type { ApplicationData, CheckedField, VerificationResult } from "./types"
import { upscaleForExtraction } from "./upscale"

/**
 * Fields eligible for the assisted (primed) second read. The government
 * warning is deliberately excluded: the model knows the statutory text by
 * heart, so priming it there maximizes the risk of normalizing a deviating
 * label back to the expected wording. A failing warning gets a BLIND
 * stability re-read instead (rereadWarning + applyWarningStability), which
 * carries no priming risk.
 */
const RECHECKABLE: ReadonlySet<CheckedField> = new Set([
  "brandName",
  "classType",
  "alcoholContent",
  "netContents",
  "nameAddress",
  "countryOfOrigin",
])

export async function verifyLabel(
  application: ApplicationData,
  image: ExtractionInput
): Promise<VerificationResult> {
  const startedAt = Date.now()

  // Small images get a lanczos upscale before any model sees them — at
  // native size the encoder can't resolve fine print and the language
  // prior autocompletes it (see upscale.ts for the measurements).
  image = await upscaleForExtraction(image)

  // The blind warning re-read runs in parallel with the main extraction on
  // EVERY label, because it is needed on both sides of the verdict. On a
  // failing warning it is the stability check (does the deviation
  // reproduce?). On a PASSING warning it is the normalization check —
  // measured (typo-warning, 2026-06-12): a printed "impares" was
  // transcribed as the statutory "impairs" in 16/16 single reads, silently
  // auto-approving a non-compliant label; a warning now auto-passes only
  // when two independent reads agree on it. Firing it up front also removes
  // the sequential second call the fail path used to pay.
  const [extractionRead, warningReread] = await Promise.allSettled([
    extractLabel(image),
    rereadWarning(image),
  ])
  if (extractionRead.status === "rejected") {
    throw extractionRead.reason
  }
  const extraction = extractionRead.value

  let { overall, fields } = runRules(application, extraction)

  // An unreadable (or non-label) image short-circuits: nothing was checked,
  // so there is nothing to recheck, challenge, or roll up.
  if (overall !== "unreadable") {
    // A failing comparison field gets one more model call before the label
    // is auto-rejected — the blind pass garbles condensed print (measured:
    // "APPELLATION" → APPALATION, "IMPAIRS" → IMPARES). The focused re-read
    // sees the application's claim, and the rules cap its effect at
    // close_match: it can rescue a label into human review, never pass it
    // (applyRecheck).
    if (overall === "fail") {
      const disputed = fields.filter(
        (f) =>
          RECHECKABLE.has(f.field) &&
          (f.status === "mismatch" || f.status === "not_found")
      )
      if (disputed.length > 0) {
        try {
          const reads = await recheckDisputedFields(
            image,
            disputed.map((f) => ({
              field: f.field,
              claim: f.expected,
              firstRead: f.found,
            }))
          )
          fields = applyRecheck(application, fields, reads)
        } catch {
          // The blind verdict stands when a re-read fails — re-reads are an
          // accuracy bonus, not a required step; a transient API failure
          // must not block the result.
        }
      }
    }

    // Merge the warning re-read: stability on a failing warning, challenge
    // on a passing one. Both are capped at close_match — a second read
    // moves a label toward review, never toward pass (applyWarningStability
    // / applyWarningChallenge). A failed re-read call changes nothing.
    if (warningReread.status === "fulfilled") {
      fields = applyWarningStability(fields, warningReread.value)
      fields = applyWarningChallenge(fields, warningReread.value)
    }
    overall = rollUpOverall(fields, extraction.readability)
  }

  const extractionMs = Date.now() - startedAt

  return {
    overall,
    fields,
    extraction,
    extractionMs,
    model: extractionModel(),
  }
}
