/**
 * Deterministic comparison rules.
 *
 * Everything in this file is a pure function: extraction + application data
 * in, field results out. No AI, no I/O. The compliance logic lives here so it
 * can be unit-tested and audited independently of the model.
 */

import type {
  ApplicationData,
  CheckedField,
  FieldResult,
  FieldStatus,
  LabelExtraction,
  OverallStatus,
  VerificationResult,
} from "./types"

/**
 * Statutory health warning text, 27 CFR 16.21. The wording must match
 * word-for-word; "GOVERNMENT WARNING" must be in capital letters and bold.
 */
export const GOVERNMENT_WARNING_TEXT =
  "GOVERNMENT WARNING: (1) According to the Surgeon General, women should " +
  "not drink alcoholic beverages during pregnancy because of the risk of " +
  "birth defects. (2) Consumption of alcoholic beverages impairs your " +
  "ability to drive a car or operate machinery, and may cause health problems."

/** Collapse whitespace and normalize typographic quotes/dashes. */
export function canonicalize(text: string): string {
  return text
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
}

/** Aggressive normalization for "same name, different styling" comparisons. */
export function normalizeLoose(text: string): string {
  return canonicalize(text)
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

/**
 * Compare a free-text field (brand name, class/type).
 *
 * Exact match passes. A match that only differs in case/punctuation (Dave's
 * "STONE'S THROW" vs "Stone's Throw") is a close_match — flagged for the
 * agent but not an automatic failure.
 */
export function compareText(
  expected: string,
  found: string | null
): {
  status: FieldStatus
  note: string | null
} {
  if (found === null || canonicalize(found) === "") {
    return { status: "not_found", note: "Not found on the label." }
  }
  if (canonicalize(expected) === canonicalize(found)) {
    return { status: "match", note: null }
  }
  if (normalizeLoose(expected) === normalizeLoose(found)) {
    return {
      status: "close_match",
      note: "Same wording — differs only in capitalization or punctuation.",
    }
  }
  return {
    status: "mismatch",
    note: "Label text does not match the application.",
  }
}

/**
 * Compare the class/type designation. Same semantics as compareText, except
 * a label that prints extra designation text around the expected class — an
 * appellation line read together with it, e.g. "Barbera d'Asti D.O.C.G. Red
 * wine" against an application's "Red wine" — is a close match for human
 * review rather than an automatic failure.
 */
export function compareClassType(
  expected: string,
  found: string | null
): { status: FieldStatus; note: string | null } {
  const base = compareText(expected, found)
  if (base.status !== "mismatch" || found === null) return base
  if (
    isTokenSubsequence(
      normalizeLoose(expected).split(" "),
      normalizeLoose(found).split(" ")
    )
  ) {
    return {
      status: "close_match",
      note: "The label prints additional designation text (e.g. an appellation) with the class/type — confirm they agree.",
    }
  }
  return base
}

const UNICODE_FRACTIONS: Record<string, string> = {
  "¼": " 1/4",
  "½": " 1/2",
  "¾": " 3/4",
  "⅛": " 1/8",
  "⅜": " 3/8",
  "⅝": " 5/8",
  "⅞": " 7/8",
}

/** "4 3/8" or "3/8" or "4.5" → numeric value. */
function parseNumberWithFraction(text: string): number {
  const m = text.trim().match(/^(?:(\d+(?:\.\d+)?)\s+)?(\d+)\/(\d+)$/)
  if (m) {
    return (
      (m[1] ? parseFloat(m[1]) : 0) + parseInt(m[2], 10) / parseInt(m[3], 10)
    )
  }
  return parseFloat(text)
}

/**
 * Pull an ABV percentage out of a label alcohol statement.
 *
 * Handles the common formats: "45% Alc./Vol.", "ALC. 45% BY VOL.",
 * "ABV 45%", "4½% BY VOLUME", "4 3/8%", and falls back to proof
 * ("90 Proof" -> 45%) when no percentage is printed. Older and imported
 * labels often print both by-weight and by-volume figures — ABV is the
 * by-volume one, so a percentage followed by "VOL" wins.
 */
export function parseAbv(text: string): number | null {
  let t = canonicalize(text).toUpperCase()
  for (const [glyph, ascii] of Object.entries(UNICODE_FRACTIONS)) {
    t = t.replaceAll(glyph, ascii)
  }

  // Every percentage in the statement, with what follows it for context.
  const candidates: { value: number; context: string }[] = []
  const pctRe = /(\d+(?:\.\d+)?(?:\s+\d+\/\d+)?|\d+\/\d+)\s*%/g
  for (const m of t.matchAll(pctRe)) {
    const value = parseNumberWithFraction(m[1])
    // Guards against degenerate fractions like "5/0%" reading as Infinity.
    if (!Number.isFinite(value)) continue
    candidates.push({
      value,
      context: t.slice(m.index + m[0].length, m.index + m[0].length + 24),
    })
  }
  if (candidates.length > 0) {
    // Classify by whichever qualifier appears first after the number.
    const kind = (context: string): "volume" | "weight" | "plain" => {
      const vol = context.search(/\bVOL/)
      const wt = context.search(/\bWEIGHT|\bWT\b/)
      if (vol === -1 && wt === -1) return "plain"
      if (wt === -1 || (vol !== -1 && vol < wt)) return "volume"
      return "weight"
    }
    const byVolume = candidates.find((c) => kind(c.context) === "volume")
    if (byVolume) return byVolume.value
    const plain = candidates.find((c) => kind(c.context) === "plain")
    return (plain ?? candidates[0]).value
  }

  // "ALC 40 BY VOL" style without a % sign.
  const alcVol = t.match(/ALC\.?\s*(\d+(?:\.\d+)?)\s*(?:%\s*)?(?:BY\s+)?VOL/)
  if (alcVol) return parseFloat(alcVol[1])

  // Proof only — US proof is exactly twice ABV.
  const proof = t.match(/(\d+(?:\.\d+)?)\s*PROOF/)
  if (proof) return parseFloat(proof[1]) / 2

  return null
}

export function compareAbv(
  expectedPercent: number,
  found: string | null
): { status: FieldStatus; note: string | null } {
  if (found === null || canonicalize(found) === "") {
    return { status: "not_found", note: "No alcohol content statement found." }
  }
  const parsed = parseAbv(found)
  if (parsed === null) {
    return {
      status: "mismatch",
      note: `Could not read a percentage from "${found}".`,
    }
  }
  // Tolerance covers float noise only — the numbers must agree.
  if (Math.abs(parsed - expectedPercent) < 0.01) {
    return { status: "match", note: null }
  }
  return {
    status: "mismatch",
    note: `Label shows ${parsed}% — application says ${expectedPercent}%.`,
  }
}

const ML_PER_UNIT: Record<string, number> = {
  ML: 1,
  MILLILITER: 1,
  MILLILITERS: 1,
  CL: 10,
  CENTILITER: 10,
  CENTILITERS: 10,
  L: 1000,
  LITER: 1000,
  LITERS: 1000,
  LITRE: 1000,
  LITRES: 1000,
  "FL OZ": 29.5735,
  "FLUID OUNCE": 29.5735,
  "FLUID OUNCES": 29.5735,
  OZ: 29.5735,
  PT: 473.176,
  PINT: 473.176,
  PINTS: 473.176,
  QT: 946.353,
  QUART: 946.353,
  GAL: 3785.41,
  GALLON: 3785.41,
  GALLONS: 3785.41,
}

/** Parse a net-contents string to milliliters, or null if unparseable. */
export function parseNetContentsMl(text: string): number | null {
  const t = canonicalize(text)
    .toUpperCase()
    // Strip abbreviation periods ("FL. OZ.") without touching decimals (1.75).
    .replace(/\.(?!\d)/g, "")
    .replace(/FL\s+OZ/, "FL OZ")

  const m = t.match(
    /(\d+(?:\.\d+)?)\s*(FL OZ|ML|CL|L|MILLILITERS?|CENTILITERS?|LIT(?:ER|RE)S?|FLUID OUNCES?|OZ|PT|PINTS?|QT|QUARTS?|GAL|GALLONS?)\b/
  )
  if (!m) return null
  const value = parseFloat(m[1])
  const factor = ML_PER_UNIT[m[2]]
  if (factor === undefined) return null
  return value * factor
}

/**
 * Boilerplate qualifier some labels print before the quantity ("NET
 * CONTENTS", "Net. Cont."). Ignored when judging whether the same volume is
 * also written the same way — the qualifier carries no information.
 */
const NET_QUALIFIER_RE = /^net\.?\s*cont(?:ents)?\.?\s*:?\s*/i

export function compareNetContents(
  expected: string,
  found: string | null
): { status: FieldStatus; note: string | null } {
  if (found === null || canonicalize(found) === "") {
    return { status: "not_found", note: "No net contents statement found." }
  }
  const expectedMl = parseNetContentsMl(expected)
  const foundMl = parseNetContentsMl(found)
  if (expectedMl === null || foundMl === null) {
    // Fall back to text comparison when units can't be parsed.
    return compareText(expected, found)
  }
  // Same volume expressed in different units (e.g. 75 cL vs 750 mL) passes
  // with a note; tolerance absorbs unit-conversion rounding.
  if (Math.abs(expectedMl - foundMl) < 0.5) {
    const strip = (text: string) =>
      normalizeLoose(canonicalize(text).replace(NET_QUALIFIER_RE, ""))
    const sameText = strip(expected) === strip(found)
    return sameText
      ? { status: "match", note: null }
      : {
          status: "close_match",
          note: "Same volume, written differently on the label.",
        }
  }
  return {
    status: "mismatch",
    note: `Label shows ${found} — application says ${expected}.`,
  }
}

/**
 * Qualifying phrase that the regs require before the bottler's name, e.g.
 * "BOTTLED BY", "DISTILLED AND BOTTLED BY", "IMPORTED BY" (27 CFR 5.66 et
 * seq.), plus noun-style importer prefixes like "US IMPORTER:". Stripped
 * before comparison so an application that records only the name and
 * address still matches the compliant label presentation.
 */
const QUALIFYING_PHRASE_RE =
  /^(?:(?:[\w.'&,]+\s+)*?(?:bottled|canned|packed|filled|produced|made|brewed|distilled|vinted|cellared|blended|imported|manufactured)(?:\s+(?:and|&)\s+[\w.'&]+)*\s+by|(?:u\.?s\.?\s+)?(?:sole\s+)?importers?\b)\s*:?\s*/i

/** Is `needle` an in-order token subsequence of `haystack`? */
function isTokenSubsequence(needle: string[], haystack: string[]): boolean {
  let i = 0
  for (const token of haystack) {
    if (i < needle.length && token === needle[i]) i++
  }
  return i === needle.length
}

/**
 * Compare the bottler/producer/importer name-and-address statement
 * (mandatory on every label: 27 CFR 5.66 for spirits, 4.35 for wine, 7.66
 * for malt beverages). The label's qualifying phrase is stripped, and extra
 * address detail (street, ZIP — permitted but not required) downgrades to a
 * close match rather than a failure.
 */
export function compareNameAddress(
  expected: string,
  found: string | null
): { status: FieldStatus; note: string | null } {
  if (found === null || canonicalize(found) === "") {
    return {
      status: "not_found",
      note: 'No name and address statement found — one is required on every label (e.g. "Bottled by Old Tom Distillery, Bardstown, KY").',
    }
  }
  const stripped = canonicalize(found).replace(QUALIFYING_PHRASE_RE, "")
  const base = compareText(expected, stripped || found)
  if (base.status !== "mismatch") return base

  if (
    isTokenSubsequence(
      normalizeLoose(expected).split(" "),
      normalizeLoose(stripped).split(" ")
    )
  ) {
    return {
      status: "close_match",
      note: "Label shows more address detail than the application — confirm the name and city/state agree.",
    }
  }
  return {
    status: "mismatch",
    note: "Name and address on the label do not match the application.",
  }
}

/**
 * Imported products must show a country of origin statement (CBP regs,
 * 19 CFR 134; multiple phrasings are acceptable — "Product of France",
 * "Produced in France" — so the check is that the statement names the
 * expected country).
 */
export function compareCountryOfOrigin(
  expected: string,
  found: string | null
): { status: FieldStatus; note: string | null } {
  if (found === null || canonicalize(found) === "") {
    return {
      status: "not_found",
      note: `No country of origin statement found — required on all imported products (e.g. "Product of ${expected}").`,
    }
  }
  if (normalizeLoose(found).includes(normalizeLoose(expected))) {
    return { status: "match", note: null }
  }
  return {
    status: "mismatch",
    note: `Label shows "${found}" — application says ${expected}.`,
  }
}

/**
 * The government warning must match the statutory text word-for-word, and
 * the "GOVERNMENT WARNING:" heading must be in capital letters (and bold —
 * reported as advisory since boldness can't be judged reliably from a photo).
 */
export function checkGovernmentWarning(
  warning: LabelExtraction["governmentWarning"]
): { status: FieldStatus; note: string | null } {
  if (!warning.present || !warning.verbatimText) {
    return {
      status: "not_found",
      note: "Government health warning statement is missing — required on all alcohol beverage labels.",
    }
  }

  const found = canonicalize(warning.verbatimText)
  const required = canonicalize(GOVERNMENT_WARNING_TEXT)

  // Wording check is case-insensitive; the caps requirement applies to the
  // heading and is checked separately so the agent sees the precise problem.
  if (found.toUpperCase() !== required.toUpperCase()) {
    const divergence = firstDivergence(
      found.toUpperCase(),
      required.toUpperCase()
    )
    return {
      status: "mismatch",
      note: `Warning text deviates from the required wording near: "…${divergence}…". The statement must match 27 CFR 16.21 word-for-word.`,
    }
  }

  const headingOnLabel = warning.verbatimText.slice(
    0,
    "GOVERNMENT WARNING".length
  )
  const headingIsCaps =
    headingOnLabel === "GOVERNMENT WARNING" && warning.headingAllCaps !== false
  if (!headingIsCaps) {
    return {
      status: "mismatch",
      note: `"GOVERNMENT WARNING:" must appear in capital letters — label shows "${headingOnLabel}:".`,
    }
  }

  if (warning.headingAppearsBold === false) {
    return {
      status: "close_match",
      note: "Wording is exact, but the heading may not be bold — verify visually (bold type is required).",
    }
  }

  return { status: "match", note: null }
}

/** Short snippet of `a` around the first character where it differs from `b`. */
function firstDivergence(a: string, b: string): string {
  let i = 0
  while (i < Math.min(a.length, b.length) && a[i] === b[i]) i++
  const start = Math.max(0, i - 20)
  return a.slice(start, i + 25) || "(start of text)"
}

const FIELD_LABELS: Record<string, string> = {
  brandName: "Brand name",
  classType: "Class / type",
  alcoholContent: "Alcohol content",
  netContents: "Net contents",
  nameAddress: "Name & address",
  countryOfOrigin: "Country of origin",
  governmentWarning: "Government warning",
}

export function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field
}

/** Run every rule and roll the field results up into an overall verdict. */
export function runRules(
  application: ApplicationData,
  extraction: LabelExtraction
): Pick<VerificationResult, "overall" | "fields"> {
  if (extraction.readability === "unreadable" || !extraction.isAlcoholLabel) {
    const note = !extraction.isAlcoholLabel
      ? "This image does not appear to be an alcohol beverage label."
      : "The image is too unclear to verify — request a better photograph."
    const expectedRows: [CheckedField, string][] = [
      ["brandName", application.brandName],
      ["classType", application.classType],
      ["alcoholContent", `${application.alcoholPercent}%`],
      ["netContents", application.netContents],
    ]
    expectedRows.push(["nameAddress", application.bottlerNameAddress])
    if (application.countryOfOrigin) {
      expectedRows.push(["countryOfOrigin", application.countryOfOrigin])
    }
    expectedRows.push(["governmentWarning", "Required statutory text"])
    return {
      overall: "unreadable",
      fields: expectedRows.map(([field, expected]) => ({
        field,
        status: "not_checked",
        expected,
        found: null,
        note,
      })),
    }
  }

  const brand = compareText(application.brandName, extraction.brandName)
  const classType = compareClassType(
    application.classType,
    extraction.classType
  )
  const abv = compareAbv(
    application.alcoholPercent,
    extraction.alcoholStatement
  )
  const net = compareNetContents(
    application.netContents,
    extraction.netContents
  )
  const warning = checkGovernmentWarning(extraction.governmentWarning)

  const fields: FieldResult[] = [
    {
      field: "brandName",
      expected: application.brandName,
      found: extraction.brandName,
      ...brand,
    },
    {
      field: "classType",
      expected: application.classType,
      found: extraction.classType,
      ...classType,
    },
    {
      field: "alcoholContent",
      expected: `${application.alcoholPercent}% Alc./Vol.`,
      found: extraction.alcoholStatement,
      ...abv,
    },
    {
      field: "netContents",
      expected: application.netContents,
      found: extraction.netContents,
      ...net,
    },
  ]

  // A name-and-address statement is mandatory on every label (bottler for
  // domestic products, U.S. importer for imports) and on the application
  // (TTB F 5100.31), so it is always compared.
  fields.push({
    field: "nameAddress",
    expected: application.bottlerNameAddress,
    found: extraction.nameAndAddress,
    ...compareNameAddress(
      application.bottlerNameAddress,
      extraction.nameAndAddress
    ),
  })
  if (application.countryOfOrigin) {
    fields.push({
      field: "countryOfOrigin",
      expected: application.countryOfOrigin,
      found: extraction.countryOfOrigin,
      ...compareCountryOfOrigin(
        application.countryOfOrigin,
        extraction.countryOfOrigin
      ),
    })
  }

  fields.push({
    field: "governmentWarning",
    expected: GOVERNMENT_WARNING_TEXT,
    found: extraction.governmentWarning.verbatimText,
    ...warning,
  })

  const statuses = fields.map((f) => f.status)
  let overall: OverallStatus
  if (statuses.some((s) => s === "mismatch" || s === "not_found")) {
    overall = "fail"
  } else if (
    statuses.some((s) => s === "close_match") ||
    extraction.readability === "partially_readable"
  ) {
    overall = "needs_review"
  } else {
    overall = "pass"
  }

  return { overall, fields }
}
