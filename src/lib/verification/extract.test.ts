import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_MODEL,
  DEFAULT_REASONING_EFFORT,
  extractionModel,
  imageDataUrl,
  reasoningEffort,
} from "./extract";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("extractionModel", () => {
  it("defaults to the fastest reliable vision model (measured live)", () => {
    vi.stubEnv("OPENAI_MODEL", "");
    expect(extractionModel()).toBe(DEFAULT_MODEL);
    expect(DEFAULT_MODEL).toBe("gpt-5.4-mini");
  });

  it("honors the OPENAI_MODEL override", () => {
    vi.stubEnv("OPENAI_MODEL", "gpt-5.4-nano");
    expect(extractionModel()).toBe("gpt-5.4-nano");
  });
});

describe("reasoningEffort", () => {
  it("defaults to no reasoning for latency", () => {
    vi.stubEnv("OPENAI_REASONING_EFFORT", "");
    expect(reasoningEffort()).toBe(DEFAULT_REASONING_EFFORT);
    expect(DEFAULT_REASONING_EFFORT).toBe("none");
  });

  it("honors the OPENAI_REASONING_EFFORT override", () => {
    vi.stubEnv("OPENAI_REASONING_EFFORT", "medium");
    expect(reasoningEffort()).toBe("medium");
  });
});

describe("imageDataUrl", () => {
  it("builds a data URL from media type and base64 payload", () => {
    expect(imageDataUrl({ imageBase64: "AAAA", mediaType: "image/png" })).toBe(
      "data:image/png;base64,AAAA",
    );
  });
});
