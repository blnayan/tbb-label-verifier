/**
 * Request input validation — pure functions so they're unit-testable
 * independently of the Next.js route handler.
 */

import type { ApplicationData } from "./types"
import type { SupportedImageMediaType } from "./extract"

export type Result<T> = { ok: true; data: T } | { ok: false; error: string }

/**
 * Parse the application form fields (all arrive as strings from FormData or
 * a CSV row) into validated ApplicationData.
 */
export function parseApplicationFields(
  fields: Record<string, unknown>
): Result<ApplicationData> {
  const text = (key: string, label: string): Result<string> => {
    const raw = fields[key]
    const value = typeof raw === "string" ? raw.trim() : ""
    if (!value) return { ok: false, error: `${label} is required.` }
    return { ok: true, data: value }
  }

  const brandName = text("brandName", "Brand name")
  if (!brandName.ok) return brandName
  const classType = text("classType", "Class/type designation")
  if (!classType.ok) return classType
  const netContents = text("netContents", "Net contents")
  if (!netContents.ok) return netContents
  const bottlerNameAddress = text(
    "bottlerNameAddress",
    "Bottler/producer/importer name and address"
  )
  if (!bottlerNameAddress.ok) return bottlerNameAddress

  const rawPercent = fields["alcoholPercent"]
  const percentText =
    typeof rawPercent === "string" ? rawPercent.trim().replace(/%$/, "") : ""
  if (!percentText) {
    return { ok: false, error: "Alcohol content is required." }
  }
  const alcoholPercent = Number(percentText)
  if (!Number.isFinite(alcoholPercent)) {
    return {
      ok: false,
      error: `Alcohol content must be a number, but got "${rawPercent}".`,
    }
  }
  if (alcoholPercent <= 0 || alcoholPercent > 100) {
    return {
      ok: false,
      error: "Alcohol content must be between 0 and 100 percent.",
    }
  }

  // Optional field — blank means "domestic product", so the country-of-origin
  // label check is skipped rather than failed.
  const optionalText = (key: string): string | undefined => {
    const raw = fields[key]
    const value = typeof raw === "string" ? raw.trim() : ""
    return value || undefined
  }

  const countryOfOrigin = optionalText("countryOfOrigin")

  // The imported flag makes the country-of-origin requirement conditional:
  // imports must name a country (the label check then runs), domestic
  // products must not. When the flag is absent (older CSVs, direct API
  // calls), a present country implies an import — today's behavior.
  const importedRaw = optionalText("imported")?.toLowerCase()
  if (importedRaw !== undefined) {
    const imported = ["yes", "true", "y", "1", "imported"].includes(importedRaw)
    const domestic = ["no", "false", "n", "0", "domestic"].includes(importedRaw)
    if (!imported && !domestic) {
      return {
        ok: false,
        error: `Imported must be yes or no, but got "${importedRaw}".`,
      }
    }
    if (imported && !countryOfOrigin) {
      return {
        ok: false,
        error:
          "Country of origin is required for imported products. Every import must name one on the label (19 CFR 134).",
      }
    }
    if (domestic && countryOfOrigin) {
      return {
        ok: false,
        error:
          "Country of origin was provided but the product is marked domestic. Mark it imported or clear the country.",
      }
    }
  }

  return {
    ok: true,
    data: {
      brandName: brandName.data,
      classType: classType.data,
      netContents: netContents.data,
      alcoholPercent,
      bottlerNameAddress: bottlerNameAddress.data,
      countryOfOrigin,
    },
  }
}

/** 10 MB cap — generous for phone photos, small enough to keep uploads fast. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024

// No GIF: animation frames make "the pixels that were verified" ambiguous,
// and every processing step (downscale, upscale) would have to special-case
// flattening them.
const SUPPORTED_TYPES: ReadonlySet<string> = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
])

export function validateImage(
  mediaType: string,
  sizeBytes: number
):
  | { ok: true; mediaType: SupportedImageMediaType }
  | { ok: false; error: string } {
  if (!SUPPORTED_TYPES.has(mediaType)) {
    return {
      ok: false,
      error: "Unsupported image format. Use JPEG, PNG, or WebP.",
    }
  }
  if (sizeBytes <= 0) {
    return { ok: false, error: "The uploaded image is empty." }
  }
  if (sizeBytes > MAX_IMAGE_BYTES) {
    return {
      ok: false,
      error: `Image is too large (max ${MAX_IMAGE_BYTES / 1024 / 1024} MB).`,
    }
  }
  return { ok: true, mediaType: mediaType as SupportedImageMediaType }
}
