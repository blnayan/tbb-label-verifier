/**
 * Core domain types for label verification.
 *
 * The pipeline has two stages:
 *  1. Extraction — an OpenAI vision model reads the label image into a
 *     LabelExtraction.
 *  2. Rules — deterministic TypeScript compares the extraction against the
 *     ApplicationData and produces a VerificationResult.
 */

/** What the agent keys in from the COLA application (or a batch CSV row). */
export interface ApplicationData {
  /** Brand name exactly as it appears on the application. */
  brandName: string
  /** Class/type designation, e.g. "Kentucky Straight Bourbon Whiskey". */
  classType: string
  /** Alcohol content as a percentage, e.g. 45 for "45% Alc./Vol.". */
  alcoholPercent: number
  /** Net contents as written on the application, e.g. "750 mL". */
  netContents: string
  /**
   * Name and address of the bottler/producer/importer, e.g.
   * "Old Tom Distillery, Bardstown, KY" (27 CFR 5.66, 4.35, 7.66).
   * Required — TTB F 5100.31 requires it on every application.
   */
  bottlerNameAddress: string
  /**
   * Country of origin for imported products, e.g. "France" (19 CFR 134).
   * Optional: leave blank for domestic products.
   */
  countryOfOrigin?: string
}

/** Structured output the vision model returns after reading the label image. */
export interface LabelExtraction {
  /** False if the image clearly isn't an alcohol beverage label. */
  isAlcoholLabel: boolean
  /** Overall legibility of the photographed label. */
  readability: "clear" | "partially_readable" | "unreadable"
  /** Brand name as printed, preserving case. Null if not found/readable. */
  brandName: string | null
  /** Class/type designation as printed. */
  classType: string | null
  /** Alcohol content verbatim, e.g. "45% ALC./VOL. (90 PROOF)". */
  alcoholStatement: string | null
  /** Net contents verbatim, e.g. "750 mL". */
  netContents: string | null
  /** Bottler/producer/importer statement verbatim, e.g. "BOTTLED BY …". */
  nameAndAddress: string | null
  /** Country of origin statement verbatim, e.g. "PRODUCT OF FRANCE". */
  countryOfOrigin: string | null
  governmentWarning: {
    present: boolean
    /** Verbatim transcription preserving case, punctuation, and numbering. */
    verbatimText: string | null
    /** Whether the "GOVERNMENT WARNING:" heading is printed in all caps. */
    headingAllCaps: boolean | null
    /** Whether the heading appears bold relative to the body text. */
    headingAppearsBold: boolean | null
  }
  /** Anything affecting confidence: glare, angle, blur, partial crop. */
  imageQualityNotes: string | null
}

export type FieldStatus =
  | "match" // exact match — pass
  | "close_match" // same content, different case/punctuation — pass w/ note
  | "mismatch" // substantive difference — fail
  | "not_found" // expected on the label but not present/readable
  | "not_checked" // skipped (e.g. image unreadable)

export type CheckedField =
  | "brandName"
  | "classType"
  | "alcoholContent"
  | "netContents"
  | "nameAddress"
  | "countryOfOrigin"
  | "governmentWarning"

export interface FieldResult {
  field: CheckedField
  status: FieldStatus
  /** Value from the application (what we expected to see). */
  expected: string
  /** Value read off the label (verbatim where possible). */
  found: string | null
  /** Human-readable explanation shown to the agent. */
  note: string | null
}

export type OverallStatus =
  | "pass" // every check matched
  | "needs_review" // close matches or advisory notes — human judgment
  | "fail" // at least one substantive mismatch or missing element
  | "unreadable" // image too poor to verify — request a better image

export interface VerificationResult {
  overall: OverallStatus
  fields: FieldResult[]
  extraction: LabelExtraction
  /** Wall-clock milliseconds spent on the vision extraction call. */
  extractionMs: number
  /** Model that performed the extraction (for the audit trail). */
  model: string
}
