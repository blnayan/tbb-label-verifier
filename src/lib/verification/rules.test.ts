import { describe, expect, it } from "vitest";

import {
  GOVERNMENT_WARNING_TEXT,
  canonicalize,
  checkGovernmentWarning,
  compareAbv,
  compareNetContents,
  compareText,
  normalizeLoose,
  parseAbv,
  parseNetContentsMl,
  runRules,
} from "./rules";
import type { ApplicationData, LabelExtraction } from "./types";

describe("canonicalize", () => {
  it("collapses whitespace and trims", () => {
    expect(canonicalize("  OLD   TOM\n DISTILLERY ")).toBe("OLD TOM DISTILLERY");
  });

  it("normalizes curly quotes to straight quotes", () => {
    expect(canonicalize("Stone’s Throw")).toBe("Stone's Throw");
  });
});

describe("normalizeLoose", () => {
  it("uppercases and strips punctuation", () => {
    expect(normalizeLoose("Stone's Throw")).toBe("STONES THROW");
  });
});

describe("compareText (brand name / class type)", () => {
  it("exact match passes", () => {
    expect(compareText("OLD TOM DISTILLERY", "OLD TOM DISTILLERY").status).toBe(
      "match",
    );
  });

  it("Dave's nuance: STONE'S THROW vs Stone's Throw is a close match, not a failure", () => {
    const result = compareText("Stone's Throw", "STONE'S THROW");
    expect(result.status).toBe("close_match");
  });

  it("curly vs straight apostrophes still match exactly", () => {
    expect(compareText("Stone's Throw", "Stone’s Throw").status).toBe("match");
  });

  it("different names mismatch", () => {
    expect(compareText("OLD TOM", "YOUNG HARRY").status).toBe("mismatch");
  });

  it("missing label value reports not_found", () => {
    expect(compareText("OLD TOM", null).status).toBe("not_found");
  });
});

describe("parseAbv", () => {
  it.each([
    ["45% Alc./Vol. (90 Proof)", 45],
    ["45% ALC/VOL", 45],
    ["ALC. 13.5% BY VOL.", 13.5],
    ["ABV 5.2%", 5.2],
    ["40 % vol", 40],
    ["90 PROOF", 45], // proof fallback: proof = 2 x ABV
    ["ALC 40 BY VOL", 40], // no % sign
  ])("parses %s as %d", (text, expected) => {
    expect(parseAbv(text)).toBe(expected);
  });

  it("returns null when no number is present", () => {
    expect(parseAbv("Kentucky Bourbon")).toBeNull();
  });

  // Real historical/imported labels print both by-weight and by-volume
  // figures — ABV is the by-volume one.
  it("prefers the by-volume percentage over the by-weight one", () => {
    expect(parseAbv("ALCOHOL NOT OVER 3.2% BY WEIGHT 4% BY VOLUME")).toBe(4);
  });

  it("handles unicode fractions", () => {
    expect(parseAbv("4½% ALC. BY VOL.")).toBe(4.5);
  });

  it("handles mixed-number fractions", () => {
    expect(parseAbv("4 3/8% BY VOLUME")).toBe(4.375);
  });

  it("rejects a zero-denominator fraction instead of returning Infinity", () => {
    expect(parseAbv("5/0% ALC. BY VOL.")).toBeNull();
  });
});

describe("compareAbv", () => {
  it("matches when the percentage agrees", () => {
    expect(compareAbv(45, "45% Alc./Vol. (90 Proof)").status).toBe("match");
  });

  it("mismatches when the numbers differ", () => {
    const result = compareAbv(45, "40% Alc./Vol.");
    expect(result.status).toBe("mismatch");
    expect(result.note).toContain("40");
    expect(result.note).toContain("45");
  });

  it("reports not_found for a missing statement", () => {
    expect(compareAbv(45, null).status).toBe("not_found");
  });
});

describe("parseNetContentsMl", () => {
  it.each([
    ["750 mL", 750],
    ["750ML", 750],
    ["75 cl", 750],
    ["1 L", 1000],
    ["1.75 L", 1750],
    ["750 milliliters", 750],
  ])("parses %s as %d mL", (text, expected) => {
    expect(parseNetContentsMl(text)).toBeCloseTo(expected, 1);
  });

  it("parses fluid ounces", () => {
    expect(parseNetContentsMl("12 FL OZ")).toBeCloseTo(354.88, 1);
  });

  it("returns null for unparseable text", () => {
    expect(parseNetContentsMl("a generous pour")).toBeNull();
  });
});

describe("compareNetContents", () => {
  it("same text matches", () => {
    expect(compareNetContents("750 mL", "750 mL").status).toBe("match");
  });

  it("same volume in different units is a close match", () => {
    expect(compareNetContents("750 mL", "75 cl").status).toBe("close_match");
  });

  it("different volumes mismatch", () => {
    expect(compareNetContents("750 mL", "1 L").status).toBe("mismatch");
  });
});

const exactWarning = (overrides?: Partial<LabelExtraction["governmentWarning"]>) =>
  ({
    present: true,
    verbatimText: GOVERNMENT_WARNING_TEXT,
    headingAllCaps: true,
    headingAppearsBold: true,
    ...overrides,
  }) satisfies LabelExtraction["governmentWarning"];

describe("checkGovernmentWarning", () => {
  it("exact statutory text passes", () => {
    expect(checkGovernmentWarning(exactWarning()).status).toBe("match");
  });

  it("missing warning is not_found", () => {
    expect(
      checkGovernmentWarning({
        present: false,
        verbatimText: null,
        headingAllCaps: null,
        headingAppearsBold: null,
      }).status,
    ).toBe("not_found");
  });

  it("Jenny's catch: 'Government Warning' in title case is rejected", () => {
    const titleCase = GOVERNMENT_WARNING_TEXT.replace(
      "GOVERNMENT WARNING",
      "Government Warning",
    );
    const result = checkGovernmentWarning(
      exactWarning({ verbatimText: titleCase, headingAllCaps: false }),
    );
    expect(result.status).toBe("mismatch");
    expect(result.note).toContain("capital letters");
  });

  it("creative rewording is rejected with the divergence point", () => {
    const reworded = GOVERNMENT_WARNING_TEXT.replace(
      "should not drink",
      "should avoid",
    );
    const result = checkGovernmentWarning(exactWarning({ verbatimText: reworded }));
    expect(result.status).toBe("mismatch");
    expect(result.note).toContain("word-for-word");
  });

  it("line breaks and spacing differences are tolerated", () => {
    const wrapped = GOVERNMENT_WARNING_TEXT.replace(
      "during pregnancy",
      "during\npregnancy",
    );
    expect(checkGovernmentWarning(exactWarning({ verbatimText: wrapped })).status).toBe(
      "match",
    );
  });

  it("non-bold heading is flagged for review, not failed", () => {
    const result = checkGovernmentWarning(
      exactWarning({ headingAppearsBold: false }),
    );
    expect(result.status).toBe("close_match");
    expect(result.note).toContain("bold");
  });
});

const application: ApplicationData = {
  brandName: "OLD TOM DISTILLERY",
  classType: "Kentucky Straight Bourbon Whiskey",
  alcoholPercent: 45,
  netContents: "750 mL",
};

const cleanExtraction: LabelExtraction = {
  isAlcoholLabel: true,
  readability: "clear",
  brandName: "OLD TOM DISTILLERY",
  classType: "Kentucky Straight Bourbon Whiskey",
  alcoholStatement: "45% Alc./Vol. (90 Proof)",
  netContents: "750 mL",
  governmentWarning: exactWarning(),
  imageQualityNotes: null,
};

describe("runRules — overall verdict", () => {
  it("all exact matches yield pass", () => {
    const { overall, fields } = runRules(application, cleanExtraction);
    expect(overall).toBe("pass");
    expect(fields).toHaveLength(5);
    expect(fields.every((f) => f.status === "match")).toBe(true);
  });

  it("a close match downgrades to needs_review", () => {
    const { overall } = runRules(application, {
      ...cleanExtraction,
      brandName: "Old Tom Distillery",
    });
    expect(overall).toBe("needs_review");
  });

  it("an ABV mismatch yields fail", () => {
    const { overall } = runRules(application, {
      ...cleanExtraction,
      alcoholStatement: "40% Alc./Vol.",
    });
    expect(overall).toBe("fail");
  });

  it("a missing government warning yields fail", () => {
    const { overall } = runRules(application, {
      ...cleanExtraction,
      governmentWarning: {
        present: false,
        verbatimText: null,
        headingAllCaps: null,
        headingAppearsBold: null,
      },
    });
    expect(overall).toBe("fail");
  });

  it("partially readable images are flagged needs_review even when fields match", () => {
    const { overall } = runRules(application, {
      ...cleanExtraction,
      readability: "partially_readable",
    });
    expect(overall).toBe("needs_review");
  });

  it("unreadable images short-circuit to unreadable with no checks run", () => {
    const { overall, fields } = runRules(application, {
      ...cleanExtraction,
      readability: "unreadable",
    });
    expect(overall).toBe("unreadable");
    expect(fields.every((f) => f.status === "not_checked")).toBe(true);
  });

  it("non-label images short-circuit to unreadable", () => {
    const { overall } = runRules(application, {
      ...cleanExtraction,
      isAlcoholLabel: false,
    });
    expect(overall).toBe("unreadable");
  });
});
