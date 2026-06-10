import { describe, expect, it } from "vitest";

import { temperatureFor } from "./extract";

describe("temperatureFor", () => {
  it.each(["claude-haiku-4-5", "claude-sonnet-4-6"])(
    "pins temperature 0 for %s (deterministic transcription)",
    (model) => {
      expect(temperatureFor(model)).toBe(0);
    },
  );

  // Sampling parameters are removed on Opus 4.7+ and Fable — sending
  // temperature there returns a 400.
  it.each(["claude-opus-4-7", "claude-opus-4-8", "claude-fable-5"])(
    "omits temperature for %s",
    (model) => {
      expect(temperatureFor(model)).toBeUndefined();
    },
  );
});
