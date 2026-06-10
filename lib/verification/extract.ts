/**
 * Claude vision extraction — the only AI-touching module in the pipeline.
 *
 * The model's job is narrow on purpose: transcribe what is physically printed
 * on the label into structured JSON. It does not decide pass/fail — that is
 * the deterministic rule engine's job (rules.ts), so compliance behavior is
 * testable and the model is never asked to exercise regulatory judgment.
 */

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

import type { LabelExtraction } from "./types";

/**
 * Haiku 4.5 by default: the assignment has a hard ~5 second budget per label
 * ("If we can't get results back in about 5 seconds, nobody's going to use
 * it") and extraction output is small, so the fastest vision-capable model
 * is the right default. Override with ANTHROPIC_MODEL for accuracy testing.
 */
export const DEFAULT_MODEL = "claude-haiku-4-5";

export function extractionModel(): string {
  return process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
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
      'The class/type designation exactly as printed, e.g. "Kentucky Straight Bourbon Whiskey".',
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
        "The warning transcribed exactly as printed: preserve capitalization, punctuation, and the (1)/(2) numbering. Do NOT correct it to the standard wording — transcribe what is actually printed.",
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
- The government warning matters most: transcribe every word of it exactly as printed, including any deviations from the standard wording.`;

export type SupportedImageMediaType =
  | "image/jpeg"
  | "image/png"
  | "image/gif"
  | "image/webp";

export interface ExtractionInput {
  imageBase64: string;
  mediaType: SupportedImageMediaType;
}

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) {
    client = new Anthropic({ maxRetries: 1, timeout: 30_000 });
  }
  return client;
}

/** Read the label image into a structured LabelExtraction via Claude vision. */
export async function extractLabel(
  input: ExtractionInput,
): Promise<LabelExtraction> {
  const response = await getClient().messages.parse({
    model: extractionModel(),
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: input.mediaType,
              data: input.imageBase64,
            },
          },
          {
            type: "text",
            text: "Transcribe this alcohol beverage label into the requested structure.",
          },
        ],
      },
    ],
    output_config: {
      format: zodOutputFormat(labelExtractionSchema),
    },
  });

  const parsed = response.parsed_output;
  if (!parsed) {
    throw new Error("The model did not return a valid extraction.");
  }
  return parsed;
}
