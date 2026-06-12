import { describe, expect, it } from "vitest"

import {
  GOVERNMENT_WARNING_TEXT,
  applyRecheck,
  canonicalize,
  applyWarningStability,
  checkGovernmentWarning,
  compareAbv,
  compareBrandName,
  compareClassType,
  compareCountryOfOrigin,
  compareNameAddress,
  compareNetContents,
  compareText,
  normalizeLoose,
  parseAbv,
  parseNetContentsMl,
  rollUpOverall,
  runRules,
} from "./rules"
import type { ApplicationData, LabelExtraction } from "./types"

describe("canonicalize", () => {
  it("collapses whitespace and trims", () => {
    expect(canonicalize("  OLD   TOM\n DISTILLERY ")).toBe("OLD TOM DISTILLERY")
  })

  it("normalizes curly quotes to straight quotes", () => {
    expect(canonicalize("Stone’s Throw")).toBe("Stone's Throw")
  })
})

describe("normalizeLoose", () => {
  it("uppercases and strips punctuation", () => {
    expect(normalizeLoose("Stone's Throw")).toBe("STONES THROW")
  })

  it("folds diacritics instead of deleting the letters", () => {
    expect(normalizeLoose("Bärenjäger")).toBe("BARENJAGER")
    expect(normalizeLoose("François")).toBe("FRANCOIS")
  })
})

describe("compareText (brand name / class type)", () => {
  it("exact match passes", () => {
    expect(compareText("OLD TOM DISTILLERY", "OLD TOM DISTILLERY").status).toBe(
      "match"
    )
  })

  it("Dave's nuance: STONE'S THROW vs Stone's Throw is a close match, not a failure", () => {
    const result = compareText("Stone's Throw", "STONE'S THROW")
    expect(result.status).toBe("close_match")
  })

  it("curly vs straight apostrophes still match exactly", () => {
    expect(compareText("Stone's Throw", "Stone’s Throw").status).toBe("match")
  })

  it("different names mismatch", () => {
    expect(compareText("OLD TOM", "YOUNG HARRY").status).toBe("mismatch")
  })

  it("accented label vs ASCII application is a close match, not a failure", () => {
    // Real COLA 11038001000725: form says BARENJAGER, label prints Bärenjäger.
    const result = compareText("BARENJAGER", "Bärenjäger")
    expect(result.status).toBe("close_match")
  })

  it("punctuation without a following space is a close match, not a failure", () => {
    // Real label prints "PLAINVIEW,NEW YORK" — stripping the comma must not
    // glue the words together and turn a styling quirk into a mismatch.
    const result = compareText("PLAINVIEW, NEW YORK 11803", "PLAINVIEW,NEW YORK 11803")
    expect(result.status).toBe("close_match")
  })

  it("missing label value reports not_found", () => {
    expect(compareText("OLD TOM", null).status).toBe("not_found")
  })

  it("near-miss: a one-word misread is a close_match for review, not an auto-reject", () => {
    // House of Harvey, measured live: the label prints "APPELLATION" in
    // condensed type and models transcribe APPALATION / APPALLATION. A
    // couple of stray characters is as likely a misread as a label typo —
    // either way a human decides.
    const result = compareText(
      "APPELLATION AMERICAN SPARKLING WINE",
      "APPALATION AMERICAN SPARKLING WINE"
    )
    expect(result.status).toBe("close_match")
    expect(result.note).toContain("character")
  })

  it("a genuinely different word is still a mismatch (Eagle Harbor vs Eagle Hollow)", () => {
    expect(compareText("EAGLE HARBOR", "EAGLE HOLLOW").status).toBe("mismatch")
  })
})

describe("compareBrandName", () => {
  it("a capitalization-only difference is a full match (STONE'S THROW vs Stone's Throw)", () => {
    const result = compareBrandName("Stone's Throw", "STONE'S THROW")
    expect(result.status).toBe("match")
    expect(result.note).toContain("capitalization")
  })

  it("a punctuation difference is still only a close_match", () => {
    // Dropping the apostrophe is more than styling — keep human eyes on it.
    const result = compareBrandName("Stone's Throw", "STONES THROW")
    expect(result.status).toBe("close_match")
  })

  it("a diacritic difference is still only a close_match (BARENJAGER vs Bärenjäger)", () => {
    const result = compareBrandName("BARENJAGER", "Bärenjäger")
    expect(result.status).toBe("close_match")
  })

  it("extra printed words around the brand are a close_match, not a failure", () => {
    // Stillwater keg collar: the fanciful name "Debutante" is printed
    // directly under the brand and models read them as one line.
    const result = compareBrandName(
      "Stillwater Artisanal",
      "Stillwater Artisanal Debutante"
    )
    expect(result.status).toBe("close_match")
    expect(result.note).toContain("additional")
  })

  it("a different brand is still a mismatch", () => {
    expect(compareBrandName("EAGLE HARBOR", "EAGLE HOLLOW").status).toBe(
      "mismatch"
    )
  })
})

describe("parseAbv", () => {
  it.each([
    ["45% Alc./Vol. (90 Proof)", 45],
    ["45% ALC/VOL", 45],
    ["ALC. 13.5% BY VOL.", 13.5],
    ["ABV 5.2%", 5.2],
    ["40 % vol", 40],
    ["ALC 40 BY VOL", 40], // no % sign
  ])("parses %s as %d", (text, expected) => {
    expect(parseAbv(text)).toBe(expected)
  })

  it("returns null when no number is present", () => {
    expect(parseAbv("Kentucky Bourbon")).toBeNull()
  })

  it("does NOT treat a proof statement as an ABV percentage", () => {
    // Proof is permitted only in addition to the mandatory percent-ABV
    // statement (27 CFR 5.65) — it is not an alcohol content statement.
    expect(parseAbv("90 PROOF")).toBeNull()
  })

  // Real historical/imported labels print both by-weight and by-volume
  // figures — ABV is the by-volume one.
  it("prefers the by-volume percentage over the by-weight one", () => {
    expect(parseAbv("ALCOHOL NOT OVER 3.2% BY WEIGHT 4% BY VOLUME")).toBe(4)
  })

  it("handles unicode fractions", () => {
    expect(parseAbv("4½% ALC. BY VOL.")).toBe(4.5)
  })

  it("handles mixed-number fractions", () => {
    expect(parseAbv("4 3/8% BY VOLUME")).toBe(4.375)
  })

  it("rejects a zero-denominator fraction instead of returning Infinity", () => {
    expect(parseAbv("5/0% ALC. BY VOL.")).toBeNull()
  })
})

describe("compareAbv", () => {
  it("matches when the percentage agrees", () => {
    expect(compareAbv(45, "45% Alc./Vol. (90 Proof)").status).toBe("match")
  })

  it("mismatches when the numbers differ", () => {
    const result = compareAbv(45, "40% Alc./Vol.")
    expect(result.status).toBe("mismatch")
    expect(result.note).toContain("40")
    expect(result.note).toContain("45")
  })

  it("reports not_found for a missing statement", () => {
    expect(compareAbv(45, null).status).toBe("not_found")
  })

  it("a proof-only statement fails even when the proof is numerically right", () => {
    // User ruling 2026-06-12: the percent-ABV statement is mandatory —
    // proof may only appear in addition, never instead.
    const result = compareAbv(45, "90 PROOF")
    expect(result.status).toBe("mismatch")
    expect(result.note).toContain("proof")
    expect(result.note?.toLowerCase()).toContain("percent")
  })

  it("a proof-only statement that is also numerically wrong still fails", () => {
    expect(compareAbv(40, "90 PROOF").status).toBe("mismatch")
  })
})


describe("parseNetContentsMl", () => {
  it.each([
    ["750 mL", 750],
    ["750ML", 750],
    ["75 cl", 750],
    ["1 L", 1000],
    ["1.75 L", 1750],
    ["750 milliliters", 750],
  ])("parses %s as %d mL", (text, expected) => {
    expect(parseNetContentsMl(text)).toBeCloseTo(expected, 1)
  })

  it("parses fluid ounces", () => {
    expect(parseNetContentsMl("12 FL OZ")).toBeCloseTo(354.88, 1)
  })

  it("returns null for unparseable text", () => {
    expect(parseNetContentsMl("a generous pour")).toBeNull()
  })
})

describe("compareNetContents", () => {
  it("same text matches", () => {
    expect(compareNetContents("750 mL", "750 mL").status).toBe("match")
  })

  it('ignores a boilerplate "Net Cont." prefix on the label', () => {
    expect(compareNetContents("750 ml", "Net. Cont. 750 ml").status).toBe(
      "match"
    )
    expect(compareNetContents("750 mL", "Net cont. 750 mL").status).toBe(
      "match"
    )
    expect(compareNetContents("NET CONTENTS 750ML", "750ML").status).toBe(
      "match"
    )
  })

  it("same volume in different units is a close match", () => {
    expect(compareNetContents("750 mL", "75 cl").status).toBe("close_match")
  })

  it("different volumes mismatch", () => {
    expect(compareNetContents("750 mL", "1 L").status).toBe("mismatch")
  })
})

describe("compareClassType", () => {
  it("exact match passes", () => {
    expect(compareClassType("Red wine", "Red wine").status).toBe("match")
  })

  it("case-only differences are a close match", () => {
    expect(compareClassType("White Wine", "WHITE WINE").status).toBe(
      "close_match"
    )
  })

  it("a class line with extra designation text around the expected class is a full match", () => {
    const result = compareClassType(
      "Red wine",
      "Barbera d'Asti D.O.C.G. Red wine"
    )
    expect(result.status).toBe("match")
    expect(result.note).toContain("Barbera d'Asti D.O.C.G. Red wine")
  })

  it("returns the matched portion of the label line, in the label's own casing", () => {
    const result = compareClassType(
      "Red wine",
      "Barbera d'Asti D.O.C.G. RED WINE"
    )
    expect(result.status).toBe("match")
    expect(result.matchedText).toBe("RED WINE")
  })

  it("collapses line breaks between the appellation and the class", () => {
    expect(
      compareClassType("Red wine", "Barbera d'Asti D.O.C.G.\nRed wine").status
    ).toBe("match")
  })

  it("a genuinely different class is a mismatch", () => {
    expect(compareClassType("Vodka", "Straight Rye Whiskey").status).toBe(
      "mismatch"
    )
  })

  it("the expected tokens must appear in order — scattered words don't count", () => {
    expect(compareClassType("Red wine", "Wine made from red grapes").status).toBe(
      "mismatch"
    )
  })
})

describe("compareNameAddress (bottler/producer/importer, 27 CFR 5.66 / 4.35 / 7.66)", () => {
  const expected = "Old Tom Distillery, Bardstown, KY"

  it("exact match passes", () => {
    expect(compareNameAddress(expected, expected).status).toBe("match")
  })

  it('a leading qualifying phrase like "BOTTLED BY" still matches — the regs require it', () => {
    expect(
      compareNameAddress(
        expected,
        "Bottled by Old Tom Distillery, Bardstown, KY"
      ).status
    ).toBe("match")
  })

  it('handles compound phrases like "DISTILLED AND BOTTLED BY"', () => {
    expect(
      compareNameAddress(
        expected,
        "Distilled and Bottled by Old Tom Distillery, Bardstown, KY"
      ).status
    ).toBe("match")
  })

  it('handles "Imported by" for imported products', () => {
    expect(
      compareNameAddress(
        "XYZ Imports, New York, NY",
        "Imported by XYZ Imports, New York, NY"
      ).status
    ).toBe("match")
  })

  it('strips a "US IMPORTER:" prefix — how imported beer labels often phrase it', () => {
    expect(
      compareNameAddress(
        "TITA ITALIAN IMPORT & EXPORT LLC MIAMI FL 33142",
        "US IMPORTER: TITA ITALIAN IMPORT & EXPORT LLC MIAMI FL 33142"
      ).status
    ).toBe("match")
  })

  it("missing space after a comma is a close match, not a failure", () => {
    // Real COLA 25225001000521: the label prints "PLAINVIEW,NEW YORK 11803".
    expect(
      compareNameAddress(
        "CALIFORNIA WINE CELLARS INC. PLAINVIEW, NEW YORK 11803",
        "IMPORTED BY: CALIFORNIA WINE CELLARS INC. PLAINVIEW,NEW YORK 11803"
      ).status
    ).toBe("close_match")
  })

  it('tolerates a spaced colon after the phrase, as printed on real labels ("IMPORTED BY : …")', () => {
    expect(
      compareNameAddress(
        "Buffalo Peak Selections, New York, NY",
        "IMPORTED BY : BUFFALO PEAK SELECTIONS, NEW YORK, NY"
      ).status
    ).toBe("close_match")
  })

  it("case/punctuation differences are a close match, not a failure", () => {
    const result = compareNameAddress(
      expected,
      "BOTTLED BY OLD TOM DISTILLERY BARDSTOWN KY"
    )
    expect(result.status).toBe("close_match")
  })

  it("extra address detail on the label (street, zip) is a close match with a note", () => {
    const result = compareNameAddress(
      expected,
      "Bottled by Old Tom Distillery, 12 Barrel Rd, Bardstown, KY 40004"
    )
    expect(result.status).toBe("close_match")
    expect(result.note).toBeTruthy()
  })

  it("a different city is a mismatch", () => {
    expect(
      compareNameAddress(
        expected,
        "Bottled by Old Tom Distillery, Louisville, KY"
      ).status
    ).toBe("mismatch")
  })

  it("missing statement is not_found — name and address are mandatory", () => {
    const result = compareNameAddress(expected, null)
    expect(result.status).toBe("not_found")
  })
})

describe("compareCountryOfOrigin (imports, 19 CFR 134)", () => {
  it('matches "Product of France" against expected country "France"', () => {
    expect(compareCountryOfOrigin("France", "Product of France").status).toBe(
      "match"
    )
  })

  it('matches "Produced in France"', () => {
    expect(compareCountryOfOrigin("France", "Produced in France").status).toBe(
      "match"
    )
  })

  it("matches regardless of case", () => {
    expect(compareCountryOfOrigin("France", "PRODUCT OF FRANCE").status).toBe(
      "match"
    )
  })

  it("a different country is a mismatch", () => {
    const result = compareCountryOfOrigin("France", "Product of Italy")
    expect(result.status).toBe("mismatch")
    expect(result.note).toContain("France")
  })

  it("missing statement is not_found — required on all imports", () => {
    const result = compareCountryOfOrigin("France", null)
    expect(result.status).toBe("not_found")
    expect(result.note).toContain("import")
  })
})

const exactWarning = (
  overrides?: Partial<LabelExtraction["governmentWarning"]>
) =>
  ({
    present: true,
    verbatimText: GOVERNMENT_WARNING_TEXT,
    headingAllCaps: true,
    headingAppearsBold: true,
    ...overrides,
  }) satisfies LabelExtraction["governmentWarning"]

describe("checkGovernmentWarning", () => {
  it("exact statutory text passes", () => {
    expect(checkGovernmentWarning(exactWarning()).status).toBe("match")
  })

  it("missing warning is not_found", () => {
    expect(
      checkGovernmentWarning({
        present: false,
        verbatimText: null,
        headingAllCaps: null,
        headingAppearsBold: null,
      }).status
    ).toBe("not_found")
  })

  it("Jenny's catch: 'Government Warning' in title case is rejected", () => {
    const titleCase = GOVERNMENT_WARNING_TEXT.replace(
      "GOVERNMENT WARNING",
      "Government Warning"
    )
    const result = checkGovernmentWarning(
      exactWarning({ verbatimText: titleCase, headingAllCaps: false })
    )
    expect(result.status).toBe("mismatch")
    expect(result.note).toContain("capital letters")
  })

  it("creative rewording is rejected with the divergence point", () => {
    const reworded = GOVERNMENT_WARNING_TEXT.replace(
      "should not drink",
      "should avoid"
    )
    const result = checkGovernmentWarning(
      exactWarning({ verbatimText: reworded })
    )
    expect(result.status).toBe("mismatch")
    expect(result.note).toContain("word-for-word")
  })

  it("line breaks and spacing differences are tolerated", () => {
    const wrapped = GOVERNMENT_WARNING_TEXT.replace(
      "during pregnancy",
      "during\npregnancy"
    )
    expect(
      checkGovernmentWarning(exactWarning({ verbatimText: wrapped })).status
    ).toBe("match")
  })

  it("a missing space is a close_match — condensed print drops spaces in transcription, so a human decides", () => {
    // ZD Wines, measured live: the label prints "(2) CONSUMPTION" in tight
    // condensed type and the model transcribed "(2)CONSUMPTION".
    const missingSpace = GOVERNMENT_WARNING_TEXT.replace(
      "(2) Consumption",
      "(2)Consumption"
    )
    const result = checkGovernmentWarning(
      exactWarning({ verbatimText: missingSpace })
    )
    expect(result.status).toBe("close_match")
    expect(result.note).toContain("spacing")
  })

  it("a missing comma is a close_match — the reader drops commas on curved print, so a human decides", () => {
    // Stillwater, measured live: the label prints "Surgeon General," on an
    // arc and the model drops the comma in roughly half of its reads.
    const missingComma = GOVERNMENT_WARNING_TEXT.replace(
      "Surgeon General,",
      "Surgeon General"
    )
    const result = checkGovernmentWarning(
      exactWarning({ verbatimText: missingComma })
    )
    expect(result.status).toBe("close_match")
    expect(result.note).toContain("punctuation")
    expect(result.note).toContain("SURGEON GENERAL")
  })

  it("an added comma is also a close_match, with the divergence pinpointed", () => {
    const addedComma = GOVERNMENT_WARNING_TEXT.replace(
      "machinery, and may",
      "machinery, and, may"
    )
    const result = checkGovernmentWarning(
      exactWarning({ verbatimText: addedComma })
    )
    expect(result.status).toBe("close_match")
    expect(result.note).toContain("punctuation")
  })

  it("punctuation tolerance never excuses a word difference", () => {
    const wordSwap = GOVERNMENT_WARNING_TEXT.replace(
      "impairs your ability",
      "impedes your ability"
    )
    expect(
      checkGovernmentWarning(exactWarning({ verbatimText: wordSwap })).status
    ).toBe("mismatch")
  })

  it("punctuation tolerance never excuses a non-capitalized heading", () => {
    const titleCaseMissingComma = GOVERNMENT_WARNING_TEXT.replace(
      "GOVERNMENT WARNING",
      "Government Warning"
    ).replace("Surgeon General,", "Surgeon General")
    expect(
      checkGovernmentWarning(
        exactWarning({
          verbatimText: titleCaseMissingComma,
          headingAllCaps: false,
        })
      ).status
    ).toBe("mismatch")
  })

  it("non-bold heading is a close_match — the model misjudges weight, so a human decides", () => {
    const result = checkGovernmentWarning(
      exactWarning({ headingAppearsBold: false })
    )
    expect(result.status).toBe("close_match")
    expect(result.note).toContain("bold")
  })

  it("uncertain boldness (null) does not fail the label", () => {
    expect(
      checkGovernmentWarning(exactWarning({ headingAppearsBold: null })).status
    ).toBe("match")
  })
})

const application: ApplicationData = {
  brandName: "OLD TOM DISTILLERY",
  classType: "Kentucky Straight Bourbon Whiskey",
  alcoholPercent: 45,
  netContents: "750 mL",
  bottlerNameAddress: "Old Tom Distillery, Bardstown, KY",
}

const cleanExtraction: LabelExtraction = {
  isAlcoholLabel: true,
  readability: "clear",
  brandName: "OLD TOM DISTILLERY",
  classType: "Kentucky Straight Bourbon Whiskey",
  alcoholStatement: "45% Alc./Vol. (90 Proof)",
  netContents: "750 mL",
  nameAndAddress: "Bottled by Old Tom Distillery, Bardstown, KY",
  countryOfOrigin: null,
  governmentWarning: exactWarning(),
  imageQualityNotes: null,
}

describe("runRules — overall verdict", () => {
  it("all exact matches yield pass", () => {
    const { overall, fields } = runRules(application, cleanExtraction)
    expect(overall).toBe("pass")
    expect(fields).toHaveLength(6)
    expect(fields.every((f) => f.status === "match")).toBe(true)
  })

  it("extra class/type text still passes, and the field shows only the matched portion", () => {
    const { overall, fields } = runRules(application, {
      ...cleanExtraction,
      classType: "Aged 8 Years Kentucky Straight Bourbon Whiskey Small Batch",
    })
    expect(overall).toBe("pass")
    const row = fields.find((f) => f.field === "classType")
    expect(row?.status).toBe("match")
    expect(row?.found).toBe("Kentucky Straight Bourbon Whiskey")
    expect(row?.note).toContain(
      "Aged 8 Years Kentucky Straight Bourbon Whiskey Small Batch"
    )
  })

  it("a close match downgrades to needs_review", () => {
    // Punctuation (not just case) differs, so the brand stays a close_match.
    const { overall } = runRules(application, {
      ...cleanExtraction,
      brandName: "OLD-TOM DISTILLERY",
    })
    expect(overall).toBe("needs_review")
  })

  it("an ABV mismatch yields fail", () => {
    const { overall } = runRules(application, {
      ...cleanExtraction,
      alcoholStatement: "40% Alc./Vol.",
    })
    expect(overall).toBe("fail")
  })

  it("a missing government warning yields fail", () => {
    const { overall } = runRules(application, {
      ...cleanExtraction,
      governmentWarning: {
        present: false,
        verbatimText: null,
        headingAllCaps: null,
        headingAppearsBold: null,
      },
    })
    expect(overall).toBe("fail")
  })

  it("partially readable images are flagged needs_review even when fields match", () => {
    const { overall } = runRules(application, {
      ...cleanExtraction,
      readability: "partially_readable",
    })
    expect(overall).toBe("needs_review")
  })

  it("unreadable images short-circuit to unreadable with no checks run", () => {
    const { overall, fields } = runRules(application, {
      ...cleanExtraction,
      readability: "unreadable",
    })
    expect(overall).toBe("unreadable")
    expect(fields.every((f) => f.status === "not_checked")).toBe(true)
  })

  it("non-label images short-circuit to unreadable", () => {
    const { overall } = runRules(application, {
      ...cleanExtraction,
      isAlcoholLabel: false,
    })
    expect(overall).toBe("unreadable")
  })
})

describe("runRules — name/address and country of origin checks", () => {
  const fullApplication: ApplicationData = {
    ...application,
    countryOfOrigin: "United States",
  }

  const importExtraction: LabelExtraction = {
    ...cleanExtraction,
    countryOfOrigin: "Product of United States",
  }

  it("checks both fields when the application provides them", () => {
    const { overall, fields } = runRules(fullApplication, importExtraction)
    expect(overall).toBe("pass")
    expect(fields).toHaveLength(7)
    expect(fields.map((f) => f.field)).toContain("nameAddress")
    expect(fields.map((f) => f.field)).toContain("countryOfOrigin")
  })

  it("always checks the name/address — the application must supply it", () => {
    const { overall, fields } = runRules(application, cleanExtraction)
    const nameRow = fields.find((f) => f.field === "nameAddress")
    expect(fields).toHaveLength(6)
    expect(nameRow?.status).toBe("match")
    expect(overall).toBe("pass")
    expect(fields.map((f) => f.field)).not.toContain("countryOfOrigin")
  })

  it("fails when the application expects a name/address the label lacks", () => {
    const { overall } = runRules(fullApplication, {
      ...importExtraction,
      nameAndAddress: null,
    })
    expect(overall).toBe("fail")
  })

  it("fails when an import's country of origin is missing from the label", () => {
    const { overall } = runRules(fullApplication, {
      ...importExtraction,
      countryOfOrigin: null,
    })
    expect(overall).toBe("fail")
  })

  it("includes the optional fields as not_checked when the image is unreadable", () => {
    const { fields } = runRules(fullApplication, {
      ...importExtraction,
      readability: "unreadable",
    })
    expect(fields).toHaveLength(7)
    expect(fields.every((f) => f.status === "not_checked")).toBe(true)
  })
})

describe("applyRecheck — assisted second read of disputed fields", () => {
  // House of Harvey, measured live: blind read garbles the condensed
  // "APPELLATION" (or drops it); a focused re-read recovers it.
  const hohApplication: ApplicationData = {
    ...application,
    classType: "APPELLATION AMERICAN SPARKLING WINE",
  }
  const misreadExtraction: LabelExtraction = {
    ...cleanExtraction,
    classType: "AMERICAN SPARKLING WINE",
  }

  it("a re-read agreeing with the application rescues a mismatch into close_match — never match", () => {
    const { fields } = runRules(hohApplication, misreadExtraction)
    const rechecked = applyRecheck(hohApplication, fields, {
      classType: "APPELLATION AMERICAN SPARKLING WINE",
    })
    const row = rechecked.find((f) => f.field === "classType")
    expect(row?.status).toBe("close_match")
    expect(row?.found).toBe("APPELLATION AMERICAN SPARKLING WINE")
    expect(row?.note).toContain("AMERICAN SPARKLING WINE")
    expect(row?.note).toContain("second read")
  })

  it("the rescued verdict rolls up to needs_review, not pass", () => {
    const { fields } = runRules(hohApplication, misreadExtraction)
    const rechecked = applyRecheck(hohApplication, fields, {
      classType: "APPELLATION AMERICAN SPARKLING WINE",
    })
    expect(rollUpOverall(rechecked, "clear")).toBe("needs_review")
  })

  it("a re-read confirming the first read leaves the failure standing", () => {
    const wrongBrand = runRules(application, {
      ...cleanExtraction,
      brandName: "EAGLE HOLLOW",
    })
    const rechecked = applyRecheck(application, wrongBrand.fields, {
      brandName: "EAGLE HOLLOW",
    })
    expect(rechecked.find((f) => f.field === "brandName")?.status).toBe(
      "mismatch"
    )
  })

  it("a null re-read leaves not_found standing", () => {
    const noBottler = runRules(application, {
      ...cleanExtraction,
      nameAndAddress: null,
    })
    const rechecked = applyRecheck(application, noBottler.fields, {
      nameAddress: null,
    })
    expect(rechecked.find((f) => f.field === "nameAddress")?.status).toBe(
      "not_found"
    )
  })

  it("a re-read that finds a missing field rescues not_found into close_match", () => {
    const noBottler = runRules(application, {
      ...cleanExtraction,
      nameAndAddress: null,
    })
    const rechecked = applyRecheck(application, noBottler.fields, {
      nameAddress: "Bottled by Old Tom Distillery, Bardstown, KY",
    })
    expect(rechecked.find((f) => f.field === "nameAddress")?.status).toBe(
      "close_match"
    )
  })

  it("a re-read that still disagrees with the application leaves the mismatch standing", () => {
    const wrongAbv = runRules(application, {
      ...cleanExtraction,
      alcoholStatement: "40% Alc./Vol.",
    })
    const rechecked = applyRecheck(application, wrongAbv.fields, {
      alcoholContent: "40% Alc./Vol.",
    })
    expect(rechecked.find((f) => f.field === "alcoholContent")?.status).toBe(
      "mismatch"
    )
  })

  it("fields that did not fail are untouched even when a re-read is present", () => {
    const { fields } = runRules(application, cleanExtraction)
    const rechecked = applyRecheck(application, fields, {
      brandName: "SOMETHING ELSE",
    })
    expect(rechecked.find((f) => f.field === "brandName")?.status).toBe("match")
    expect(rechecked.find((f) => f.field === "brandName")?.found).toBe(
      "OLD TOM DISTILLERY"
    )
  })
})

describe("applyWarningStability — blind second read of a failing warning", () => {
  // European Standard, measured live: a degraded image made the blind read
  // transcribe "IMPAIRS" as "IMPARES" — a word-level garble of a compliant
  // label that used to auto-reject.
  const garbled = GOVERNMENT_WARNING_TEXT.replace("impairs", "impares")
  const garbledExtraction: LabelExtraction = {
    ...cleanExtraction,
    governmentWarning: exactWarning({ verbatimText: garbled }),
  }
  const missingExtraction: LabelExtraction = {
    ...cleanExtraction,
    governmentWarning: {
      present: false,
      verbatimText: null,
      headingAllCaps: null,
      headingAppearsBold: null,
    },
  }

  it("a re-read that returns the statutory text rescues the failure into close_match — never match", () => {
    const { fields } = runRules(application, garbledExtraction)
    const stabilized = applyWarningStability(fields, exactWarning())
    const row = stabilized.find((f) => f.field === "governmentWarning")
    expect(row?.status).toBe("close_match")
    expect(row?.note).toContain("second")
    expect(rollUpOverall(stabilized, "clear")).toBe("needs_review")
  })

  it("a re-read reproducing the same deviation leaves the failure standing, with the confirmation noted", () => {
    const { fields } = runRules(application, garbledExtraction)
    const stabilized = applyWarningStability(
      fields,
      exactWarning({ verbatimText: garbled })
    )
    const row = stabilized.find((f) => f.field === "governmentWarning")
    expect(row?.status).toBe("mismatch")
    expect(row?.note).toContain("second")
  })

  it("two reads of the same deviation may differ in punctuation — still reproduced, still failing", () => {
    const { fields } = runRules(application, garbledExtraction)
    const garbledNoComma = garbled.replace("machinery, and", "machinery and")
    const stabilized = applyWarningStability(
      fields,
      exactWarning({ verbatimText: garbledNoComma })
    )
    expect(
      stabilized.find((f) => f.field === "governmentWarning")?.status
    ).toBe("mismatch")
  })

  it("a warning missing in both reads stays not_found", () => {
    const { fields } = runRules(application, missingExtraction)
    const stabilized = applyWarningStability(fields, {
      present: false,
      verbatimText: null,
      headingAllCaps: null,
      headingAppearsBold: null,
    })
    expect(
      stabilized.find((f) => f.field === "governmentWarning")?.status
    ).toBe("not_found")
  })

  it("a warning the first read missed but the re-read found goes to review", () => {
    const { fields } = runRules(application, missingExtraction)
    const stabilized = applyWarningStability(fields, exactWarning())
    expect(
      stabilized.find((f) => f.field === "governmentWarning")?.status
    ).toBe("close_match")
  })

  it("two reads that garble the text differently mean the transcription is unstable — review", () => {
    const { fields } = runRules(application, garbledExtraction)
    const otherGarble = GOVERNMENT_WARNING_TEXT.replace("impairs", "imparts")
    const stabilized = applyWarningStability(
      fields,
      exactWarning({ verbatimText: otherGarble })
    )
    expect(
      stabilized.find((f) => f.field === "governmentWarning")?.status
    ).toBe("close_match")
  })

  it("a passing warning is untouched", () => {
    const { fields } = runRules(application, cleanExtraction)
    const stabilized = applyWarningStability(
      fields,
      exactWarning({ verbatimText: garbled })
    )
    expect(
      stabilized.find((f) => f.field === "governmentWarning")?.status
    ).toBe("match")
  })

  it("other fields are never touched", () => {
    const { fields } = runRules(application, {
      ...garbledExtraction,
      brandName: "EAGLE HOLLOW",
    })
    const stabilized = applyWarningStability(fields, exactWarning())
    expect(stabilized.find((f) => f.field === "brandName")?.status).toBe(
      "mismatch"
    )
  })
})
