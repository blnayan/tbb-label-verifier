/**
 * Server-side pre-upscale of small label images before vision extraction.
 *
 * Measured (typo-warning sample, 2026-06-12): on a 900px-wide render, the
 * model transcribed a printed "impares" as the statutory "impairs" in every
 * read at any prompt — the encoder cannot resolve the letters at that size,
 * so the language prior fills them in. Lanczos-upscaled to 1800px the
 * faithful-read rate went from 0/12 to ~70%, with IDENTICAL input token
 * counts (the API resamples internally either way) — wider than 1800px
 * changed nothing. Upscaling adds no information, but it stops the API's
 * own preprocessing from being the resolution bottleneck.
 *
 * Large images are passed through byte-for-byte: re-encoding photographs
 * measurably degrades fine print (see ARCHITECTURE.md on the client-side
 * downscale), and they already have the pixels.
 */

import sharp from "sharp"

import type { ExtractionInput } from "./extract"

/** Below this width, fine print measurably outruns the vision encoder. */
export const MIN_LEGIBLE_WIDTH = 1600
/** Faithful reads saturate here — wider costs bytes and buys nothing. */
export const TARGET_WIDTH = 1800
/** PNG output of an upscale roughly 4×s the bytes — keep the payload sane. */
const MAX_INPUT_BYTES = 4 * 1024 * 1024

export function upscaleTargetWidth(input: {
  width: number | undefined
  bytes: number
  mediaType: string
}): number | null {
  if (input.mediaType === "image/gif") return null
  if (input.bytes > MAX_INPUT_BYTES) return null
  if (input.width === undefined || input.width >= MIN_LEGIBLE_WIDTH) {
    return null
  }
  return TARGET_WIDTH
}

/**
 * Upscale a small image to TARGET_WIDTH for extraction; anything that
 * should not (or cannot) be upscaled passes through untouched — the
 * upscale is an accuracy bonus, never a gate.
 */
export async function upscaleForExtraction(
  input: ExtractionInput
): Promise<ExtractionInput> {
  const bytes = Buffer.from(input.imageBase64, "base64")
  try {
    const meta = await sharp(bytes).metadata()
    const target = upscaleTargetWidth({
      width: meta.width,
      bytes: bytes.length,
      mediaType: input.mediaType,
    })
    if (target === null) return input
    const out = await sharp(bytes)
      .resize({ width: target, kernel: "lanczos3" })
      .png()
      .toBuffer()
    return { imageBase64: out.toString("base64"), mediaType: "image/png" }
  } catch {
    return input
  }
}
