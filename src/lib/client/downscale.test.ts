import { describe, expect, it } from "vitest"

import { MAX_IMAGE_BYTES } from "@/lib/verification/input"

import { needsDownscale } from "./downscale"

describe("needsDownscale", () => {
  it("leaves the European Standard crown label untouched (regression)", () => {
    // Measured live: this 404KB PNG passes 18/18 as-is, but a resample +
    // JPEG re-encode made the model misread "IMPAIRS" in the tiny warning
    // text 6/8 times — an auto-reject on a compliant label.
    expect(needsDownscale(404_122)).toBe(false)
  })

  it("leaves a typical 12MP phone photo untouched — the server accepts it as-is", () => {
    expect(needsDownscale(4_500_000)).toBe(false)
  })

  it("leaves a file at exactly the server limit untouched", () => {
    expect(needsDownscale(MAX_IMAGE_BYTES)).toBe(false)
  })

  it("downscales a file the server would reject", () => {
    expect(needsDownscale(MAX_IMAGE_BYTES + 1)).toBe(true)
  })
})
