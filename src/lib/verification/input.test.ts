import { describe, expect, it } from "vitest"

import { MAX_IMAGE_BYTES, parseApplicationFields, validateImage } from "./input"

describe("parseApplicationFields", () => {
  const valid = {
    brandName: "OLD TOM DISTILLERY",
    classType: "Kentucky Straight Bourbon Whiskey",
    alcoholPercent: "45",
    netContents: "750 mL",
    bottlerNameAddress: "Old Tom Distillery, Bardstown, KY",
  }

  it("accepts valid fields and coerces the percentage to a number", () => {
    const result = parseApplicationFields(valid)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.alcoholPercent).toBe(45)
      expect(result.data.brandName).toBe("OLD TOM DISTILLERY")
    }
  })

  it("accepts decimal percentages", () => {
    const result = parseApplicationFields({ ...valid, alcoholPercent: "13.5" })
    expect(result.ok && result.data.alcoholPercent).toBe(13.5)
  })

  it("accepts a percentage already suffixed with %", () => {
    const result = parseApplicationFields({ ...valid, alcoholPercent: "45%" })
    expect(result.ok && result.data.alcoholPercent).toBe(45)
  })

  it("trims surrounding whitespace from text fields", () => {
    const result = parseApplicationFields({
      ...valid,
      brandName: "  OLD TOM  ",
    })
    expect(result.ok && result.data.brandName).toBe("OLD TOM")
  })

  it.each([
    ["brandName", ""],
    ["classType", "   "],
    ["netContents", ""],
    ["bottlerNameAddress", "   "],
  ])("rejects a blank %s", (key, value) => {
    const result = parseApplicationFields({ ...valid, [key]: value })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.toLowerCase()).toContain("required")
  })

  it("rejects a non-numeric alcohol percentage", () => {
    const result = parseApplicationFields({
      ...valid,
      alcoholPercent: "forty five",
    })
    expect(result.ok).toBe(false)
  })

  it.each(["0", "-3", "101"])(
    "rejects an out-of-range percentage: %s",
    (alcoholPercent) => {
      const result = parseApplicationFields({ ...valid, alcoholPercent })
      expect(result.ok).toBe(false)
    }
  )

  it("rejects missing fields", () => {
    const result = parseApplicationFields({ brandName: "X" })
    expect(result.ok).toBe(false)
  })

  it("requires the bottler name/address — TTB F 5100.31 requires it on the application", () => {
    const withoutBottler: Record<string, unknown> = { ...valid }
    delete withoutBottler.bottlerNameAddress
    const result = parseApplicationFields(withoutBottler)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.toLowerCase()).toContain("name and address")
      expect(result.error.toLowerCase()).toContain("required")
    }
  })

  it("passes through the bottler name/address and optional country of origin", () => {
    const result = parseApplicationFields({
      ...valid,
      countryOfOrigin: "United States",
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.bottlerNameAddress).toBe(
        "Old Tom Distillery, Bardstown, KY"
      )
      expect(result.data.countryOfOrigin).toBe("United States")
    }
  })

  it("treats a blank country of origin as omitted", () => {
    const result = parseApplicationFields({ ...valid, countryOfOrigin: "" })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.countryOfOrigin).toBeUndefined()
    }
  })

  describe("imported flag", () => {
    it("requires a country of origin when the product is marked imported", () => {
      const result = parseApplicationFields({ ...valid, imported: "yes" })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toContain("Country of origin")
        expect(result.error.toLowerCase()).toContain("imported")
      }
    })

    it("accepts an imported product with a country of origin", () => {
      const result = parseApplicationFields({
        ...valid,
        imported: "yes",
        countryOfOrigin: "France",
      })
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.data.countryOfOrigin).toBe("France")
    })

    it("rejects a country of origin on a product marked domestic", () => {
      const result = parseApplicationFields({
        ...valid,
        imported: "no",
        countryOfOrigin: "France",
      })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.toLowerCase()).toContain("domestic")
    })

    it("accepts a domestic product without a country of origin", () => {
      const result = parseApplicationFields({ ...valid, imported: "no" })
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.data.countryOfOrigin).toBeUndefined()
    })

    it.each(["yes", "true", "y", "1", "imported"])(
      "accepts %s as imported",
      (imported) => {
        const result = parseApplicationFields({
          ...valid,
          imported,
          countryOfOrigin: "Italy",
        })
        expect(result.ok).toBe(true)
      }
    )

    it.each(["no", "false", "n", "0", "domestic"])(
      "accepts %s as domestic",
      (imported) => {
        const result = parseApplicationFields({ ...valid, imported })
        expect(result.ok).toBe(true)
      }
    )

    it("rejects an unrecognized imported value", () => {
      const result = parseApplicationFields({ ...valid, imported: "maybe" })
      expect(result.ok).toBe(false)
    })

    it("infers imported from the country when the flag is absent (legacy)", () => {
      const result = parseApplicationFields({
        ...valid,
        countryOfOrigin: "France",
      })
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.data.countryOfOrigin).toBe("France")
    })
  })
})

describe("validateImage", () => {
  it("accepts a jpeg under the size cap", () => {
    const result = validateImage("image/jpeg", 1024)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.mediaType).toBe("image/jpeg")
  })

  it.each(["image/png", "image/webp"])("accepts %s", (type) => {
    expect(validateImage(type, 1024).ok).toBe(true)
  })

  it("rejects unsupported types", () => {
    const result = validateImage("application/pdf", 1024)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain("JPEG")
  })

  it("rejects GIFs — animation frames make the verified pixels ambiguous", () => {
    const result = validateImage("image/gif", 1024)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain("JPEG")
  })

  it("rejects images over the size cap", () => {
    expect(validateImage("image/jpeg", MAX_IMAGE_BYTES + 1).ok).toBe(false)
  })

  it("rejects empty files", () => {
    expect(validateImage("image/jpeg", 0).ok).toBe(false)
  })
})
