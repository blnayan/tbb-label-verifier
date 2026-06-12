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
    .normalize("NFD") // fold diacritics (Bärenjäger → Barenjager), not delete them
    .replace(/[\u0300-\u036f]/g, "")
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
      note: "Same wording. Only the capitalization or punctuation differs.",
    }
  }
  // Compare characters alone — catches labels that drop the space after
  // punctuation ("PLAINVIEW,NEW YORK"), where stripping the comma above
  // glues the words together and a styling quirk would read as a mismatch.
  if (
    normalizeLoose(expected).replace(/ /g, "") ===
    normalizeLoose(found).replace(/ /g, "")
  ) {
    return {
      status: "close_match",
      note: "Same characters. Only the spacing or punctuation differs.",
    }
  }
  // Near-miss: a couple of stray characters in a long string (measured:
  // condensed "APPELLATION" transcribed as APPALATION) is as likely the
  // model misreading as the label misprinting — both are review, not
  // auto-reject. The budget scales with length and stays far below word
  // substitutions ("HOLLOW" vs "HARBOR" is 4 edits and still fails).
  const a = normalizeLoose(expected).replace(/ /g, "")
  const b = normalizeLoose(found).replace(/ /g, "")
  const budget = Math.min(4, Math.floor(Math.max(a.length, b.length) / 12) + 1)
  const distance = editDistance(a, b)
  if (distance <= budget) {
    return {
      status: "close_match",
      note: `Nearly identical, off by ${distance} character${distance === 1 ? "" : "s"}. This could be a transcription misread, so confirm on the image.`,
    }
  }
  return {
    status: "mismatch",
    note: "Label text does not match the application.",
  }
}

/** Levenshtein distance — both inputs are short normalized strings. */
function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const current = [i]
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        prev[j] + 1,
        current[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      )
    }
    prev = current
  }
  return prev[b.length]
}

/**
 * Compare the brand name. Same semantics as compareText, with two brand
 * specific tolerances: a capitalization-only difference is a full match
 * (labels routinely set the brand in display caps — punctuation,
 * apostrophes, and diacritics still must agree exactly), and a label
 * that prints additional words around the brand — typically a fanciful
 * name read as part of the same line, e.g. "Stillwater Artisanal
 * Debutante" against an application's "Stillwater Artisanal" — is a close
 * match for human review rather than an automatic failure.
 */
export function compareBrandName(
  expected: string,
  found: string | null
): { status: FieldStatus; note: string | null } {
  const base = compareText(expected, found)
  if (
    base.status === "close_match" &&
    found !== null &&
    canonicalize(expected).toUpperCase() === canonicalize(found).toUpperCase()
  ) {
    return {
      status: "match",
      note: "Same name. Only the capitalization differs.",
    }
  }
  if (base.status !== "mismatch" || found === null) return base
  if (
    isTokenSubsequence(
      normalizeLoose(expected).split(" "),
      normalizeLoose(found).split(" ")
    )
  ) {
    return {
      status: "close_match",
      note: "The label prints additional words with the brand, such as a fanciful name. Confirm they agree.",
    }
  }
  return base
}

/**
 * Compare the class/type designation. Same semantics as compareText, except
 * a label that prints extra designation text around the expected class — an
 * appellation line read together with it, e.g. "Barbera d'Asti D.O.C.G. Red
 * wine" against an application's "Red wine" — is a full match: the expected
 * designation is on the label, and the surrounding text (appellation, age
 * statement, fanciful qualifier) carries no compliance signal against the
 * application. `matchedText` is the portion of the label line that matched,
 * in the label's own casing, so the result can display exactly what matched;
 * the note keeps the full line for transparency.
 */
export function compareClassType(
  expected: string,
  found: string | null
): { status: FieldStatus; note: string | null; matchedText?: string } {
  const base = compareText(expected, found)
  if (base.status !== "mismatch" || found === null) return base
  const matchedText = matchedSubsequenceText(expected, found)
  if (matchedText !== null) {
    return {
      status: "match",
      note: `The label prints additional designation text with the class/type ("${canonicalize(found)}"). The application's designation appears within it.`,
      matchedText,
    }
  }
  return base
}

/**
 * When every token of `expected` appears, in order, within `found`, return
 * those tokens as they are printed on the label (original casing and
 * punctuation). Null when `expected` is not contained in `found`.
 */
function matchedSubsequenceText(
  expected: string,
  found: string
): string | null {
  const needle = normalizeLoose(expected).split(" ").filter(Boolean)
  const originalTokens = canonicalize(found).split(" ").filter(Boolean)
  const matched: string[] = []
  let i = 0
  for (const token of originalTokens) {
    if (i < needle.length && normalizeLoose(token) === needle[i]) {
      matched.push(token)
      i++
    }
  }
  return i === needle.length ? matched.join(" ") : null
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
 * "ABV 5.2%", "4½% BY VOLUME", "4 3/8%". Older and imported labels often
 * print both by-weight and by-volume figures — ABV is the by-volume one,
 * so a percentage followed by "VOL" wins. A proof figure is deliberately
 * NOT read as ABV: the percent statement is mandatory (27 CFR 5.65) and
 * proof may only accompany it, so "90 Proof" alone parses to null and
 * compareAbv reports why.
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

  return null
}

/** US proof is exactly twice ABV; null when no proof figure is printed. */
export function parseProof(text: string): number | null {
  const proof = canonicalize(text)
    .toUpperCase()
    .match(/(\d+(?:\.\d+)?)\s*PROOF/)
  return proof ? parseFloat(proof[1]) : null
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
    const proof = parseProof(found)
    if (proof !== null) {
      const equivalence =
        Math.abs(proof / 2 - expectedPercent) < 0.01
          ? `equivalent to the application's ${expectedPercent}%, but the percentage must still be printed`
          : `equivalent to ${proof / 2}%, while the application says ${expectedPercent}%`
      return {
        status: "mismatch",
        note: `The label states alcohol content in proof only ("${found}"). A percent-alcohol-by-volume statement is required, and proof may only appear in addition. ${proof} proof is ${equivalence}.`,
      }
    }
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
    note: `Label shows ${parsed}%, but the application says ${expectedPercent}%.`,
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
    note: `Label shows ${found}, but the application says ${expected}.`,
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
      note: 'No name and address statement found. One is required on every label, e.g. "Bottled by Old Tom Distillery, Bardstown, KY".',
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
      note: "Label shows more address detail than the application. Confirm the name and city/state agree.",
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
      note: `No country of origin statement found. One is required on all imported products, e.g. "Product of ${expected}".`,
    }
  }
  if (normalizeLoose(found).includes(normalizeLoose(expected))) {
    return { status: "match", note: null }
  }
  return {
    status: "mismatch",
    note: `Label shows "${found}", but the application says ${expected}.`,
  }
}

/**
 * The government warning must match the statutory text word-for-word, and
 * the "GOVERNMENT WARNING:" heading must be in capital letters and bold
 * type. Word-level wording and heading caps come from transcription, which
 * the model does reliably, so those are hard fails. Three judgments it does
 * NOT make reliably only queue the label for human review (close_match):
 *  - boldness (measured: MB Liquors reads as not bold);
 *  - spacing in tight condensed print (measured: ZD Wines "(2) CONSUMPTION"
 *    transcribed as "(2)CONSUMPTION");
 *  - punctuation (measured: Stillwater's arc-wrapped "Surgeon General,"
 *    loses its comma in roughly half of reads) — when every word of the
 *    statutory text is present in order and only punctuation or spacing
 *    differs, the divergence is as likely the reader as the label, so a
 *    human confirms rather than the label auto-failing.
 * A null bold judgment (can't tell) does not penalize the label.
 */
export function checkGovernmentWarning(
  warning: LabelExtraction["governmentWarning"]
): { status: FieldStatus; note: string | null } {
  if (!warning.present || !warning.verbatimText) {
    return {
      status: "not_found",
      note: "Government health warning statement is missing. It is required on all alcohol beverage labels.",
    }
  }

  const found = canonicalize(warning.verbatimText).toUpperCase()
  const required = canonicalize(GOVERNMENT_WARNING_TEXT).toUpperCase()

  // Wording check is case-insensitive; the caps requirement applies to the
  // heading and is checked separately so the agent sees the precise problem.
  // Divergences in whitespace or punctuation alone are deferred below —
  // every word intact, likely a transcription artifact.
  const spacingOnly =
    found !== required && found.replace(/ /g, "") === required.replace(/ /g, "")
  const punctuationOnly =
    found !== required &&
    !spacingOnly &&
    wordStream(found) === wordStream(required)
  if (found !== required && !spacingOnly && !punctuationOnly) {
    const divergence = firstDivergence(found, required)
    return {
      status: "mismatch",
      note: `Warning text deviates from the required wording near: "…${divergence}…". The statement must match 27 CFR 16.21 word-for-word.`,
    }
  }

  const headingOnLabel = warning.verbatimText.slice(
    0,
    "GOVERNMENT WARNING".length
  )
  // The heading itself may carry the dropped space ("GOVERNMENTWARNING"),
  // so the caps check tolerates exactly that while still requiring capitals.
  const headingIsCaps =
    /^GOVERNMENT ?WARNING/.test(warning.verbatimText) &&
    warning.headingAllCaps !== false
  if (!headingIsCaps) {
    return {
      status: "mismatch",
      note: `"GOVERNMENT WARNING:" must appear in capital letters, but the label shows "${headingOnLabel}:".`,
    }
  }

  if (warning.headingAppearsBold === false) {
    return {
      status: "close_match",
      note: '"GOVERNMENT WARNING" must appear in bold type (27 CFR 16.22). The model read the heading as not bold, a judgment it sometimes gets wrong, so confirm the type weight on the image.',
    }
  }

  if (punctuationOnly) {
    const divergence = firstDivergence(found, required)
    return {
      status: "close_match",
      note: `Wording matches word-for-word but punctuation differs near: "…${divergence}…". This is as likely the reader misreading tight or curved print as the label itself, so confirm on the image.`,
    }
  }

  if (spacingOnly) {
    const divergence = firstDivergence(found, required)
    return {
      status: "close_match",
      note: `Wording matches word-for-word but spacing differs near: "…${divergence}…". This is usually the model dropping a space in tight print, so confirm on the image.`,
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

/** The word stream alone — punctuation stripped, whitespace collapsed. */
function wordStream(text: string): string {
  return text
    .replace(/[^A-Za-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
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
      : "The image is too unclear to verify. Request a better photograph."
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

  const brand = compareBrandName(application.brandName, extraction.brandName)
  const { matchedText: classTypeMatched, ...classType } = compareClassType(
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
      // When the label prints extra designation text around the expected
      // class, show only the portion that matched — the note keeps the
      // full line.
      found: classTypeMatched ?? extraction.classType,
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

  return { overall: rollUpOverall(fields, extraction.readability), fields }
}

/** Roll field results up into the overall verdict. */
export function rollUpOverall(
  fields: FieldResult[],
  readability: LabelExtraction["readability"]
): OverallStatus {
  const statuses = fields.map((f) => f.status)
  if (statuses.some((s) => s === "mismatch" || s === "not_found")) {
    return "fail"
  }
  if (
    statuses.some((s) => s === "close_match") ||
    readability === "partially_readable"
  ) {
    return "needs_review"
  }
  return "pass"
}

/** What a focused second read returned per disputed field (null = absent). */
export type RecheckReads = Partial<Record<CheckedField, string | null>>

/**
 * Merge an assisted second read into the field results.
 *
 * The second read was primed with the application's claim (that is what
 * makes it find text the blind pass garbled — measured: House of Harvey's
 * condensed "APPELLATION"), so it is never allowed to PASS a field: when it
 * agrees with the application, the failing field is rescued to close_match
 * and a human confirms against the image. When it confirms the first read
 * or returns something else entirely, the original failure stands. Priming
 * can only move a label toward review, never toward pass.
 */
export function applyRecheck(
  application: ApplicationData,
  fields: FieldResult[],
  reads: RecheckReads
): FieldResult[] {
  const compareForField = (
    field: CheckedField,
    secondRead: string
  ): FieldStatus => {
    switch (field) {
      case "brandName":
        return compareBrandName(application.brandName, secondRead).status
      case "classType":
        return compareClassType(application.classType, secondRead).status
      case "alcoholContent":
        return compareAbv(application.alcoholPercent, secondRead).status
      case "netContents":
        return compareNetContents(application.netContents, secondRead).status
      case "nameAddress":
        return compareNameAddress(application.bottlerNameAddress, secondRead)
          .status
      case "countryOfOrigin":
        return application.countryOfOrigin
          ? compareCountryOfOrigin(application.countryOfOrigin, secondRead)
              .status
          : "not_checked"
      default:
        return "not_checked"
    }
  }

  return fields.map((f) => {
    if (f.status !== "mismatch" && f.status !== "not_found") return f
    const secondRead = reads[f.field]
    if (secondRead === undefined || secondRead === null) return f
    const agreement = compareForField(f.field, secondRead)
    if (agreement !== "match" && agreement !== "close_match") return f
    const firstRead = f.found === null ? "found nothing" : `read "${f.found}"`
    return {
      ...f,
      status: "close_match",
      found: secondRead,
      note: `A focused second read returned "${secondRead}", which agrees with the application, while the first read ${firstRead}. The second read knew the expected value, so confirm against the image.`,
    }
  })
}

/**
 * Merge a blind second read of the government warning into the field
 * results — the stability check for a warning about to fail.
 *
 * The warning is excluded from the primed recheck on purpose (the model
 * knows the statutory text by heart, so priming invites normalizing a
 * deviating label back to compliance). This read is blind instead: it never
 * sees the application or the statutory text, so it is an independent
 * sample of the same sensor. If it reproduces the first read's deviation
 * (same words — punctuation may wobble between reads), the deviation is
 * printed on the label and the failure stands with higher confidence. If
 * the two reads disagree, the transcription is unstable and the label
 * queues for human review. Same invariant as applyRecheck: a second read
 * can only move a label toward review, never toward pass.
 */
export function applyWarningStability(
  fields: FieldResult[],
  reread: LabelExtraction["governmentWarning"]
): FieldResult[] {
  return fields.map((f) => {
    if (f.field !== "governmentWarning") return f
    if (f.status !== "mismatch" && f.status !== "not_found") return f

    const second = checkGovernmentWarning(reread)
    const secondText = reread.present ? reread.verbatimText : null
    const secondHardFails =
      second.status === "mismatch" || second.status === "not_found"
    const sameWords =
      wordStream(canonicalize(f.found ?? "").toUpperCase()) ===
      wordStream(canonicalize(secondText ?? "").toUpperCase())

    if (secondHardFails && sameWords) {
      const confirmation =
        f.found === null && secondText === null
          ? "An independent second read also found no government warning."
          : "An independent second read reproduced the same text. The deviation is printed on the label, not a reading error."
      return { ...f, note: f.note ? `${f.note} ${confirmation}` : confirmation }
    }

    const firstDesc =
      f.found === null ? "found no government warning" : `read "${f.found}"`
    const secondDesc =
      secondText === null
        ? "found no government warning"
        : `read "${secondText}"`
    return {
      ...f,
      status: "close_match",
      note: `Two independent reads of the warning disagree: the first ${firstDesc}; the second ${secondDesc}. The transcription is unstable, so the deviation may be a misread. Confirm the warning on the image.`,
    }
  })
}

/**
 * Challenge a PASSING government warning with a blind second read — the
 * mirror image of applyWarningStability.
 *
 * Measured (typo-warning sample, 2026-06-12): a label printing "impares"
 * was transcribed as the statutory "impairs" in 16/16 reads — the model
 * autocompletes fine print to the wording it knows by heart, and a
 * non-compliant label auto-approves. One faithful read is the only signal
 * that catches this, so a warning passes automatically only when two
 * independent reads agree on it: a re-read that hard-fails
 * (word-level deviation or no warning found) sends the label to human
 * review. Re-read judgments known to wobble without signifying a deviation
 * — punctuation, spacing, boldness — do NOT challenge. Same invariant as
 * the other second-read rules: a challenge can only move a label toward
 * review, never toward pass, and never auto-rejects on its own (the first
 * read disagrees, so the deviation is not stable evidence).
 */
export function applyWarningChallenge(
  fields: FieldResult[],
  reread: LabelExtraction["governmentWarning"]
): FieldResult[] {
  return fields.map((f) => {
    if (f.field !== "governmentWarning") return f
    if (f.status !== "match") return f

    const second = checkGovernmentWarning(reread)
    if (second.status !== "mismatch" && second.status !== "not_found") return f

    const secondText = reread.present ? reread.verbatimText : null
    const secondDesc =
      secondText === null
        ? "found no government warning"
        : `read "${secondText}"`
    return {
      ...f,
      status: "close_match",
      note: `Two independent reads of the warning disagree: the first matched the required wording; the second ${secondDesc}. The reader can autocorrect fine print to the wording it expects, so confirm the printed warning on the image, letter by letter.`,
    }
  })
}
