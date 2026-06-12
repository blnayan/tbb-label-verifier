import { afterEach, describe, expect, it, vi } from "vitest"

import { extractionModel, imageDataUrl, reasoningEffort } from "./extract"

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("extractionModel", () => {
  it("returns the configured OPENAI_MODEL", () => {
    vi.stubEnv("OPENAI_MODEL", "gpt-5-mini")
    expect(extractionModel()).toBe("gpt-5-mini")
  })

  it("throws when OPENAI_MODEL is unset — one explicit model, no fallback", () => {
    vi.stubEnv("OPENAI_MODEL", "")
    expect(() => extractionModel()).toThrow(/OPENAI_MODEL/)
  })
})

describe("reasoningEffort", () => {
  it("returns the configured OPENAI_REASONING_EFFORT", () => {
    vi.stubEnv("OPENAI_REASONING_EFFORT", "medium")
    expect(reasoningEffort()).toBe("medium")
  })

  it("returns null when unset — the API's own default applies, no fallback", () => {
    vi.stubEnv("OPENAI_REASONING_EFFORT", "")
    expect(reasoningEffort()).toBeNull()
  })
})

describe("imageDataUrl", () => {
  it("builds a data URL from media type and base64 payload", () => {
    expect(imageDataUrl({ imageBase64: "AAAA", mediaType: "image/png" })).toBe(
      "data:image/png;base64,AAAA"
    )
  })
})
