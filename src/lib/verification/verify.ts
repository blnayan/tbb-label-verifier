/**
 * Pipeline orchestrator: a blind vision-extraction call, the deterministic
 * rule engine, and — only when a comparison field fails — one focused
 * second read of the disputed fields. Kept separate from the route handler
 * so it can be reused (CLI, batch workers) without HTTP.
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
  applyWarningStability,
  rollUpOverall,
  runRules,
} from "./rules"
import type {
  ApplicationData,
  CheckedField,
  VerificationResult,
} from "./types"

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
  const extraction = await extractLabel(image)

  let { overall, fields } = runRules(application, extraction)

  // A failing field gets one more model call before the label is
  // auto-rejected — the blind pass garbles condensed print (measured:
  // "APPELLATION" → APPALATION, "IMPAIRS" → IMPARES). Comparison fields get
  // a focused re-read that sees the application's claim; the warning gets a
  // blind stability re-read instead (priming the statutory text invites
  // normalization). Both run in parallel, and the rules cap their effect at
  // close_match: a re-read can rescue a label into human review, never pass
  // it (see applyRecheck / applyWarningStability).
  if (overall === "fail") {
    const disputed = fields.filter(
      (f) =>
        RECHECKABLE.has(f.field) &&
        (f.status === "mismatch" || f.status === "not_found")
    )
    const warningFailed = fields.some(
      (f) =>
        f.field === "governmentWarning" &&
        (f.status === "mismatch" || f.status === "not_found")
    )

    const [recheckReads, warningReread] = await Promise.allSettled([
      disputed.length > 0
        ? recheckDisputedFields(
            image,
            disputed.map((f) => ({
              field: f.field,
              claim: f.expected,
              firstRead: f.found,
            }))
          )
        : Promise.resolve(null),
      warningFailed ? rereadWarning(image) : Promise.resolve(null),
    ])

    // The blind verdict stands when a re-read fails — re-reads are an
    // accuracy bonus, not a required step; a transient API failure must
    // not block the result.
    if (recheckReads.status === "fulfilled" && recheckReads.value) {
      fields = applyRecheck(application, fields, recheckReads.value)
    }
    if (warningReread.status === "fulfilled" && warningReread.value) {
      fields = applyWarningStability(fields, warningReread.value)
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
