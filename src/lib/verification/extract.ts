/**
 * OpenAI vision extraction — the only AI-touching module in the pipeline.
 *
 * The model's job is narrow on purpose: transcribe what is physically printed
 * on the label into structured JSON. It does not decide pass/fail — that is
 * the deterministic rule engine's job (rules.ts), so compliance behavior is
 * testable and the model is never asked to exercise regulatory judgment.
 */

import OpenAI from "openai"
import { zodTextFormat } from "openai/helpers/zod"
import { z } from "zod"

import type { CheckedField, LabelExtraction } from "./types"

/**
 * The extraction model comes solely from OPENAI_MODEL — one explicitly
 * configured model, no hardcoded default to silently fall back to. When
 * picking one, mind the ~5 second budget per label ("If we can't get
 * results back in about 5 seconds, nobody's going to use it") and measure
 * live: on the 5.4 tier, mini-class read real-label fine print reliably
 * while nano-class misread the government warning AND returned slower.
 */
export function extractionModel(): string {
  const model = process.env.OPENAI_MODEL
  if (!model) {
    throw new Error(
      "Set the OPENAI_MODEL environment variable — no default model is configured."
    )
  }
  return model
}

/**
 * Reasoning effort, only if explicitly configured — valid values are
 * tier-specific ("minimal" is gpt-5's floor, "none" exists from gpt-5.1,
 * gpt-5.5 bottoms out at "low"), so there is no safe hardcoded default.
 * Unset means the request omits the parameter and the API default applies;
 * transcription needs no deliberation, so the lowest effort the chosen
 * model accepts is usually the right setting.
 */
export function reasoningEffort(): string | null {
  return process.env.OPENAI_REASONING_EFFORT || null
}

const governmentWarningSchema = z.object({
  present: z
    .boolean()
    .describe(
      'Whether the government health warning statement — the one whose heading reads "GOVERNMENT WARNING" — appears anywhere on the label. Other caution or safety notices (keg-pressure CAUTION text, sulfite or allergen declarations) are NOT the government warning.'
    ),
  verbatimText: z
    .string()
    .nullable()
    .describe(
      'The government warning transcribed exactly as printed: preserve capitalization, punctuation, and the (1)/(2) numbering. Start at the first word of the warning — if a "GOVERNMENT WARNING" heading is printed, it is part of the text and must be included. Do NOT correct it to the standard wording — transcribe what is actually printed. If the label also prints other caution or safety text (e.g. "CAUTION: This keg…"), exclude it — transcribe only the government warning statement.'
    ),
  headingAllCaps: z
    .boolean()
    .nullable()
    .describe(
      'True only if the words "GOVERNMENT WARNING" are printed entirely in capital letters.'
    ),
  headingAppearsBold: z
    .boolean()
    .nullable()
    .describe(
      "True if the GOVERNMENT WARNING heading appears bolder than the body text. Null if impossible to judge."
    ),
})

const labelExtractionSchema = z.object({
  isAlcoholLabel: z
    .boolean()
    .describe("False if the image is clearly not an alcohol beverage label."),
  readability: z
    .enum(["clear", "partially_readable", "unreadable"])
    .describe(
      "clear = all required text legible; partially_readable = some text obscured by glare/angle/blur; unreadable = cannot reliably read the label."
    ),
  brandName: z
    .string()
    .nullable()
    .describe(
      "The brand name exactly as printed, preserving capitalization and punctuation. Null if absent or unreadable."
    ),
  classType: z
    .string()
    .nullable()
    .describe(
      'The beverage class/type designation exactly as printed, e.g. "Kentucky Straight Bourbon Whiskey", "Vodka With Natural Flavors", "White Wine", "India Pale Ale". When several candidates appear, return the explicit beverage class statement — not appellations, varietals, or fanciful names (for a wine printed with both "SOAVE" and "WHITE WINE", return "WHITE WINE"; for an appellation line like "Barbera d\'Asti D.O.C.G." printed above a "Red wine" line, return only "Red wine").'
    ),
  alcoholStatement: z
    .string()
    .nullable()
    .describe(
      'The complete alcohol content statement verbatim, e.g. "45% Alc./Vol. (90 Proof)".'
    ),
  netContents: z
    .string()
    .nullable()
    .describe('The net contents statement verbatim, e.g. "750 mL".'),
  nameAndAddress: z
    .string()
    .nullable()
    .describe(
      'The bottler/producer/importer name-and-address statement verbatim, including its qualifying phrase, e.g. "BOTTLED BY OLD TOM DISTILLERY, BARDSTOWN, KY" or "IMPORTED BY XYZ IMPORTS, NEW YORK, NY". Usually small print near the bottom of the label. When both a foreign bottler and a US importer are printed, return the importer statement (phrased "IMPORTED BY ..." or "US IMPORTER: ..."). Null if absent or unreadable.'
    ),
  countryOfOrigin: z
    .string()
    .nullable()
    .describe(
      'The country of origin statement verbatim, e.g. "PRODUCT OF FRANCE" or "PRODUCED IN MEXICO". Null if none is printed (typical for domestic products).'
    ),
  governmentWarning: governmentWarningSchema,
  imageQualityNotes: z
    .string()
    .nullable()
    .describe(
      "Brief note on anything reducing confidence: glare, angle, blur, partial crop. Null if the image is clean."
    ),
})

const SYSTEM_PROMPT = `You are a transcription assistant for TTB alcohol label compliance review.

You will be shown a photograph or rendering of an alcohol beverage label. Transcribe the requested fields EXACTLY as physically printed on the label.

Rules:
- Transcribe verbatim. Preserve capitalization, punctuation, apostrophes, and numbering exactly as printed. Never normalize, correct, or autocomplete text to what it "should" say.
- Labels are often photographed at an angle, with glare, curvature, or poor lighting. Read carefully through these artifacts, and reflect genuine uncertainty in the readability field rather than guessing.
- If a field is absent or illegible, return null for it rather than inventing a value.
- The government warning matters most: transcribe every word of it exactly as printed, including any deviations from the standard wording. Include its heading (e.g. "GOVERNMENT WARNING:") in the transcription when one is printed — never drop it.
- Misprinted warnings are exactly what this review exists to catch, and misprints hide in word shape: a swapped or missing letter inside a long word reads "correctly" unless you verify its letters. After transcribing the warning, re-examine each of its words of 5+ letters in the image letter by letter and correct your transcription to the printed letters, even when that produces a misspelled word. A transcription containing a misspelling is often the correct answer.
- Labels may print other caution or safety notices alongside it (keg-pressure CAUTION text, sulfite or allergen declarations). Those are NOT the government warning — report only the statement whose heading reads "GOVERNMENT WARNING", and never substitute another notice for it.`

export type SupportedImageMediaType =
  | "image/jpeg"
  | "image/png"
  | "image/gif"
  | "image/webp"

export interface ExtractionInput {
  imageBase64: string
  mediaType: SupportedImageMediaType
}

/** The Responses API takes images as data URLs rather than raw base64. */
export function imageDataUrl(input: ExtractionInput): string {
  return `data:${input.mediaType};base64,${input.imageBase64}`
}

let client: OpenAI | null = null
function getClient(): OpenAI {
  if (!client) {
    // maxRetries 3: the SDK backs off and honors retry-after, which matters
    // since the parallel warning re-read doubled call volume — measured at
    // batch concurrency 4, bursts trip the per-minute rate limit (429) and
    // a single retry lands inside the same window.
    client = new OpenAI({ maxRetries: 3, timeout: 30_000 })
  }
  return client
}

/** Read the label image into a structured LabelExtraction via OpenAI vision. */
export async function extractLabel(
  input: ExtractionInput
): Promise<LabelExtraction> {
  const effort = reasoningEffort()
  const response = await getClient().responses.parse({
    model: extractionModel(),
    ...(effort && { reasoning: { effort: effort as "low" } }),
    max_output_tokens: 4096,
    instructions: SYSTEM_PROMPT,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_image",
            image_url: imageDataUrl(input),
            // Fine print (the government warning) needs full resolution —
            // "auto" can sample the image down below legibility.
            detail: "high",
          },
          {
            type: "input_text",
            text: "Transcribe this alcohol beverage label into the requested structure.",
          },
        ],
      },
    ],
    text: {
      format: zodTextFormat(labelExtractionSchema, "label_extraction"),
    },
  })

  const parsed = response.output_parsed
  if (!parsed) {
    throw new Error("The model did not return a valid extraction.")
  }
  return parsed
}

/** One disputed field for the focused second read. */
export interface DisputedField {
  field: CheckedField
  /** What the application claims for this field. */
  claim: string
  /** What the blind first pass transcribed (null = found nothing). */
  firstRead: string | null
}

const recheckSchema = z.object({
  brandName: z.string().nullable(),
  classType: z.string().nullable(),
  alcoholContent: z.string().nullable(),
  netContents: z.string().nullable(),
  nameAddress: z.string().nullable(),
  countryOfOrigin: z.string().nullable(),
})

export type RecheckResult = z.infer<typeof recheckSchema>

const FIELD_PROMPT_NAMES: Record<string, string> = {
  brandName: "brand name",
  classType: "class/type designation",
  alcoholContent: "alcohol content statement",
  netContents: "net contents statement",
  nameAddress: "bottler/producer/importer name and address statement",
  countryOfOrigin: "country of origin statement",
}

const RECHECK_SYSTEM_PROMPT = `You are re-examining an alcohol beverage label for a TTB compliance check.

A first transcription pass disagreed with the application paperwork on specific fields. For each disputed field you are given the application's claim and the first reading. Look at the label again, with maximum care, and transcribe exactly what is physically printed.

Rules:
- The truth is on the label, not in the paperwork. What is printed may equal the claim, the first reading, or neither — copy it character by character, exactly as printed.
- Do NOT repeat the claim unless the label really prints it. Reporting a difference is a correct answer; so is confirming the first reading.
- If a disputed field is not printed anywhere on the label, return null for it.
- Return null for every field you were not asked to re-examine.`

/**
 * Focused second read of fields whose blind transcription disagreed with
 * the application. This call sees the application's claims, so its output
 * is deliberately weaker evidence than the blind pass — the rule engine
 * never lets it produce a pass, only rescue a label into human review
 * (applyRecheck in rules.ts).
 */
export async function recheckDisputedFields(
  input: ExtractionInput,
  disputes: DisputedField[]
): Promise<RecheckResult> {
  const lines = disputes.map((d) => {
    const first =
      d.firstRead === null
        ? "the first pass found no such statement"
        : `the first pass read "${d.firstRead}"`
    return `- ${d.field} (${FIELD_PROMPT_NAMES[d.field] ?? d.field}): the application claims "${d.claim}"; ${first}.`
  })

  const effort = reasoningEffort()
  const response = await getClient().responses.parse({
    model: extractionModel(),
    ...(effort && { reasoning: { effort: effort as "low" } }),
    max_output_tokens: 2048,
    instructions: RECHECK_SYSTEM_PROMPT,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_image",
            image_url: imageDataUrl(input),
            detail: "high",
          },
          {
            type: "input_text",
            text: `Disputed fields:\n${lines.join("\n")}\n\nTranscribe exactly what the label prints for each disputed field.`,
          },
        ],
      },
    ],
    text: {
      format: zodTextFormat(recheckSchema, "label_recheck"),
    },
  })

  const parsed = response.output_parsed
  if (!parsed) {
    throw new Error("The model did not return a valid recheck.")
  }
  return parsed
}

const warningRereadSchema = z.object({
  governmentWarning: governmentWarningSchema,
})

const WARNING_REREAD_SYSTEM_PROMPT = `You are a transcription assistant for TTB alcohol label compliance review.

You will be shown a photograph or rendering of an alcohol beverage label. Transcribe ONLY the government health warning statement — the one whose heading reads "GOVERNMENT WARNING".

Rules:
- Transcribe verbatim, character by character. Preserve capitalization, punctuation, and the (1)/(2) numbering exactly as printed. Never normalize, correct, or autocomplete the text to what it "should" say — if the printed text deviates from the standard wording, your transcription must show the deviation.
- The warning is often printed small, curved, or wrapped around the label. Read it through these artifacts with maximum care, character by character.
- Misprinted warnings are exactly what this review exists to catch, and misprints hide in word shape: a swapped or missing letter inside a long word reads "correctly" unless you verify its letters. After transcribing, re-examine each word of 5+ letters in the image letter by letter and correct your transcription to the printed letters, even when that produces a misspelled word. A transcription containing a misspelling is often the correct answer.
- Other caution or safety notices (keg-pressure CAUTION text, sulfite or allergen declarations) are NOT the government warning — never substitute one for it.
- If no government warning is printed anywhere on the label, report it as not present.`

/**
 * Blind second read of just the government warning — the stability check
 * for a warning about to fail. Deliberately NOT primed: the warning is
 * excluded from recheckDisputedFields because the model knows the statutory
 * text by heart and priming invites normalizing a deviating label back to
 * compliance. This call sees neither the application nor the first read,
 * so it is an independent sample of the same sensor; the rule engine
 * compares the two reads (applyWarningStability in rules.ts) and can only
 * move the label toward review, never toward pass.
 */
export async function rereadWarning(
  input: ExtractionInput
): Promise<LabelExtraction["governmentWarning"]> {
  const effort = reasoningEffort()
  const response = await getClient().responses.parse({
    model: extractionModel(),
    ...(effort && { reasoning: { effort: effort as "low" } }),
    max_output_tokens: 2048,
    instructions: WARNING_REREAD_SYSTEM_PROMPT,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_image",
            image_url: imageDataUrl(input),
            detail: "high",
          },
          {
            type: "input_text",
            text: "Transcribe the government warning statement on this label exactly as printed.",
          },
        ],
      },
    ],
    text: {
      format: zodTextFormat(warningRereadSchema, "warning_reread"),
    },
  })

  const parsed = response.output_parsed
  if (!parsed) {
    throw new Error("The model did not return a valid warning re-read.")
  }
  return parsed.governmentWarning
}
