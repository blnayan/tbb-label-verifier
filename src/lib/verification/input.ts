/**
 * Request input validation — pure functions so they're unit-testable
 * independently of the Next.js route handler.
 */

import type { ApplicationData } from "./types";
import type { SupportedImageMediaType } from "./extract";

export type Result<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * Parse the application form fields (all arrive as strings from FormData or
 * a CSV row) into validated ApplicationData.
 */
export function parseApplicationFields(
  fields: Record<string, unknown>,
): Result<ApplicationData> {
  const text = (key: string, label: string): Result<string> => {
    const raw = fields[key];
    const value = typeof raw === "string" ? raw.trim() : "";
    if (!value) return { ok: false, error: `${label} is required.` };
    return { ok: true, data: value };
  };

  const brandName = text("brandName", "Brand name");
  if (!brandName.ok) return brandName;
  const classType = text("classType", "Class/type designation");
  if (!classType.ok) return classType;
  const netContents = text("netContents", "Net contents");
  if (!netContents.ok) return netContents;

  const rawPercent = fields["alcoholPercent"];
  const percentText =
    typeof rawPercent === "string" ? rawPercent.trim().replace(/%$/, "") : "";
  if (!percentText) {
    return { ok: false, error: "Alcohol content is required." };
  }
  const alcoholPercent = Number(percentText);
  if (!Number.isFinite(alcoholPercent)) {
    return {
      ok: false,
      error: `Alcohol content must be a number — got "${rawPercent}".`,
    };
  }
  if (alcoholPercent <= 0 || alcoholPercent > 100) {
    return {
      ok: false,
      error: "Alcohol content must be between 0 and 100 percent.",
    };
  }

  return {
    ok: true,
    data: {
      brandName: brandName.data,
      classType: classType.data,
      netContents: netContents.data,
      alcoholPercent,
    },
  };
}

/** 10 MB cap — generous for phone photos, small enough to keep uploads fast. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const SUPPORTED_TYPES: ReadonlySet<string> = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

export function validateImage(
  mediaType: string,
  sizeBytes: number,
):
  | { ok: true; mediaType: SupportedImageMediaType }
  | { ok: false; error: string } {
  if (!SUPPORTED_TYPES.has(mediaType)) {
    return {
      ok: false,
      error: "Unsupported image format — use JPEG, PNG, WebP, or GIF.",
    };
  }
  if (sizeBytes <= 0) {
    return { ok: false, error: "The uploaded image is empty." };
  }
  if (sizeBytes > MAX_IMAGE_BYTES) {
    return {
      ok: false,
      error: `Image is too large (max ${MAX_IMAGE_BYTES / 1024 / 1024} MB).`,
    };
  }
  return { ok: true, mediaType: mediaType as SupportedImageMediaType };
}
