import sharp from "sharp"
import { describe, expect, it } from "vitest"

import {
  MIN_LEGIBLE_WIDTH,
  TARGET_WIDTH,
  upscaleForExtraction,
  upscaleTargetWidth,
} from "./upscale"

const png = async (width: number, height: number) =>
  (
    await sharp({
      create: {
        width,
        height,
        channels: 3,
        background: { r: 245, g: 239, b: 223 },
      },
    })
      .png()
      .toBuffer()
  ).toString("base64")

describe("upscaleTargetWidth — when a label image needs more pixels", () => {
  it("an image narrower than the legibility floor gets the target width", () => {
    expect(
      upscaleTargetWidth({ width: 900, bytes: 100_000, mediaType: "image/png" })
    ).toBe(TARGET_WIDTH)
  })

  it("an image at or above the floor is left alone", () => {
    expect(
      upscaleTargetWidth({
        width: MIN_LEGIBLE_WIDTH,
        bytes: 100_000,
        mediaType: "image/jpeg",
      })
    ).toBeNull()
    expect(
      upscaleTargetWidth({
        width: 3000,
        bytes: 100_000,
        mediaType: "image/jpeg",
      })
    ).toBeNull()
  })

  it("an unknown width is left alone", () => {
    expect(
      upscaleTargetWidth({
        width: undefined,
        bytes: 100_000,
        mediaType: "image/png",
      })
    ).toBeNull()
  })

  it("an already-huge file is left alone — the payload would balloon", () => {
    expect(
      upscaleTargetWidth({
        width: 900,
        bytes: 8 * 1024 * 1024,
        mediaType: "image/png",
      })
    ).toBeNull()
  })

  it("GIFs are left alone — re-encoding drops animation frames", () => {
    expect(
      upscaleTargetWidth({ width: 900, bytes: 100_000, mediaType: "image/gif" })
    ).toBeNull()
  })
})

describe("upscaleForExtraction", () => {
  it("upscales a small PNG to the target width, preserving aspect ratio", async () => {
    const input = {
      imageBase64: await png(900, 1200),
      mediaType: "image/png" as const,
    }
    const out = await upscaleForExtraction(input)
    expect(out.mediaType).toBe("image/png")
    const meta = await sharp(
      Buffer.from(out.imageBase64, "base64")
    ).metadata()
    expect(meta.width).toBe(TARGET_WIDTH)
    expect(meta.height).toBe(2400)
  })

  it("returns a large image untouched — byte-identical, no re-encode", async () => {
    const input = {
      imageBase64: await png(2000, 1500),
      mediaType: "image/png" as const,
    }
    const out = await upscaleForExtraction(input)
    expect(out).toBe(input)
  })

  it("returns the input untouched when the bytes are not a decodable image", async () => {
    const input = {
      imageBase64: Buffer.from("not an image").toString("base64"),
      mediaType: "image/png" as const,
    }
    const out = await upscaleForExtraction(input)
    expect(out).toBe(input)
  })
})
