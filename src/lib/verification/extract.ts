/**
 * OpenAI vision extraction — the only AI-touching module in the pipeline.
 *
 * The model's job is narrow on purpose: transcribe what is physically printed
 * on the label into structured JSON. It does not decide pass/fail — that is
 * the deterministic rule engine's job (rules.ts), so compliance behavior is
 * testable and the model is never asked to exercise regulatory judgment.
 */

import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";

import type { LabelExtraction } from "./types";

/**
 * gpt-5.4-mini by default. The assignment has a hard ~5 second budget per
 * label ("If we can't get results back in about 5 seconds, nobody's going to
 * use it"), which pointed at gpt-5.4-nano — but measured live, nano misreads
 * the fine-print government warning on real labels (0/4 stable) while mini
 * reads it 4/4 AND returns faster (~2.3–3.2s vs ~3.1–3.5s). Fastest model
 * on paper isn't fastest in practice. Override with OPENAI_MODEL.
 */
export const DEFAULT_MODEL = "gpt-5.4-mini";

export function extractionModel(): string {
  return process.env.OPENAI_MODEL || DEFAULT_MODEL;
}

/**
 * GPT-5.4 models are reasoning models; transcription needs no deliberation,
 * and "none" measured ~1s faster than "low" with identical extractions.
 * Override with OPENAI_REASONING_EFFORT — e.g. newer tiers (gpt-5.5) drop
 * "none" and want "low".
 */
export const DEFAULT_REASONING_EFFORT = "none";

export function reasoningEffort(): string {
  return process.env.OPENAI_REASONING_EFFORT || DEFAULT_REASONING_EFFORT;
}

const labelExtractionSchema = z.object({
  isAlcoholLabel: z
    .boolean()
    .describe("False if the image is clearly not an alcohol beverage label."),
  readability: z
    .enum(["clear", "partially_readable", "unreadable"])
    .describe(
      "clear = all required text legible; partially_readable = some text obscured by glare/angle/blur; unreadable = cannot reliably read the label.",
    ),
  brandName: z
    .string()
    .nullable()
    .describe(
      "The brand name exactly as printed, preserving capitalization and punctuation. Null if absent or unreadable.",
    ),
  classType: z
    .string()
    .nullable()
    .describe(
      'The beverage class/type designation exactly as printed, e.g. "Kentucky Straight Bourbon Whiskey", "Vodka With Natural Flavors", "White Wine", "India Pale Ale". When several candidates appear, return the explicit beverage class statement — not appellations, varietals, or fanciful names (for a wine printed with both "SOAVE" and "WHITE WINE", return "WHITE WINE").',
    ),
  alcoholStatement: z
    .string()
    .nullable()
    .describe(
      'The complete alcohol content statement verbatim, e.g. "45% Alc./Vol. (90 Proof)".',
    ),
  netContents: z
    .string()
    .nullable()
    .describe('The net contents statement verbatim, e.g. "750 mL".'),
  governmentWarning: z.object({
    present: z
      .boolean()
      .describe("Whether a government health warning statement appears anywhere on the label."),
    verbatimText: z
      .string()
      .nullable()
      .describe(
        'The warning transcribed exactly as printed: preserve capitalization, punctuation, and the (1)/(2) numbering. Start at the first word of the warning — if a "GOVERNMENT WARNING" heading is printed, it is part of the text and must be included. Do NOT correct it to the standard wording — transcribe what is actually printed.',
      ),
    headingAllCaps: z
      .boolean()
      .nullable()
      .describe(
        'True only if the words "GOVERNMENT WARNING" are printed entirely in capital letters.',
      ),
    headingAppearsBold: z
      .boolean()
      .nullable()
      .describe(
        "True if the GOVERNMENT WARNING heading appears bolder than the body text. Null if impossible to judge.",
      ),
  }),
  imageQualityNotes: z
    .string()
    .nullable()
    .describe(
      "Brief note on anything reducing confidence: glare, angle, blur, partial crop. Null if the image is clean.",
    ),
});

const SYSTEM_PROMPT = `You are a transcription assistant for TTB alcohol label compliance review.

You will be shown a photograph or rendering of an alcohol beverage label. Transcribe the requested fields EXACTLY as physically printed on the label.

Rules:
- Transcribe verbatim. Preserve capitalization, punctuation, apostrophes, and numbering exactly as printed. Never normalize, correct, or autocomplete text to what it "should" say.
- Labels are often photographed at an angle, with glare, curvature, or poor lighting. Read carefully through these artifacts, and reflect genuine uncertainty in the readability field rather than guessing.
- If a field is absent or illegible, return null for it rather than inventing a value.
- The government warning matters most: transcribe every word of it exactly as printed, including any deviations from the standard wording. Include its heading (e.g. "GOVERNMENT WARNING:") in the transcription when one is printed — never drop it.`;

export type SupportedImageMediaType =
  | "image/jpeg"
  | "image/png"
  | "image/gif"
  | "image/webp";

export interface ExtractionInput {
  imageBase64: string;
  mediaType: SupportedImageMediaType;
}

/** The Responses API takes images as data URLs rather than raw base64. */
export function imageDataUrl(input: ExtractionInput): string {
  return `data:${input.mediaType};base64,${input.imageBase64}`;
}

let client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!client) {
    client = new OpenAI({ maxRetries: 1, timeout: 30_000 });
  }
  return client;
}

/** Read the label image into a structured LabelExtraction via OpenAI vision. */
export async function extractLabel(
  input: ExtractionInput,
): Promise<LabelExtraction> {
  const response = await getClient().responses.parse({
    model: extractionModel(),
    reasoning: { effort: reasoningEffort() as "low" },
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
  });

  const parsed = response.output_parsed;
  if (!parsed) {
    throw new Error("The model did not return a valid extraction.");
  }
  return parsed;
}
