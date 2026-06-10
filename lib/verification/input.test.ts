import { describe, expect, it } from "vitest";

import { MAX_IMAGE_BYTES, parseApplicationFields, validateImage } from "./input";

describe("parseApplicationFields", () => {
  const valid = {
    brandName: "OLD TOM DISTILLERY",
    classType: "Kentucky Straight Bourbon Whiskey",
    alcoholPercent: "45",
    netContents: "750 mL",
  };

  it("accepts valid fields and coerces the percentage to a number", () => {
    const result = parseApplicationFields(valid);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.alcoholPercent).toBe(45);
      expect(result.data.brandName).toBe("OLD TOM DISTILLERY");
    }
  });

  it("accepts decimal percentages", () => {
    const result = parseApplicationFields({ ...valid, alcoholPercent: "13.5" });
    expect(result.ok && result.data.alcoholPercent).toBe(13.5);
  });

  it("accepts a percentage already suffixed with %", () => {
    const result = parseApplicationFields({ ...valid, alcoholPercent: "45%" });
    expect(result.ok && result.data.alcoholPercent).toBe(45);
  });

  it("trims surrounding whitespace from text fields", () => {
    const result = parseApplicationFields({ ...valid, brandName: "  OLD TOM  " });
    expect(result.ok && result.data.brandName).toBe("OLD TOM");
  });

  it.each([
    ["brandName", ""],
    ["classType", "   "],
    ["netContents", ""],
  ])("rejects a blank %s", (key, value) => {
    const result = parseApplicationFields({ ...valid, [key]: value });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.toLowerCase()).toContain("required");
  });

  it("rejects a non-numeric alcohol percentage", () => {
    const result = parseApplicationFields({ ...valid, alcoholPercent: "forty five" });
    expect(result.ok).toBe(false);
  });

  it.each(["0", "-3", "101"])(
    "rejects an out-of-range percentage: %s",
    (alcoholPercent) => {
      const result = parseApplicationFields({ ...valid, alcoholPercent });
      expect(result.ok).toBe(false);
    },
  );

  it("rejects missing fields", () => {
    const result = parseApplicationFields({ brandName: "X" });
    expect(result.ok).toBe(false);
  });
});

describe("validateImage", () => {
  it("accepts a jpeg under the size cap", () => {
    const result = validateImage("image/jpeg", 1024);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.mediaType).toBe("image/jpeg");
  });

  it.each(["image/png", "image/webp", "image/gif"])("accepts %s", (type) => {
    expect(validateImage(type, 1024).ok).toBe(true);
  });

  it("rejects unsupported types", () => {
    const result = validateImage("application/pdf", 1024);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("JPEG");
  });

  it("rejects images over the size cap", () => {
    expect(validateImage("image/jpeg", MAX_IMAGE_BYTES + 1).ok).toBe(false);
  });

  it("rejects empty files", () => {
    expect(validateImage("image/jpeg", 0).ok).toBe(false);
  });
});
