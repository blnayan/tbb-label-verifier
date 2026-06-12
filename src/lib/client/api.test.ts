import { afterEach, describe, expect, it, vi } from "vitest"

import { VerifyError, verifyLabelRequest } from "./api"
import type { ApplicationData } from "@/lib/verification/types"

const application: ApplicationData = {
  brandName: "OLD TOM DISTILLERY",
  classType: "Kentucky Straight Bourbon Whiskey",
  alcoholPercent: 45,
  netContents: "750 mL",
  bottlerNameAddress: "Old Tom Distillery, Bardstown, KY",
}

const image = new File(["fake-bytes"], "label.png", { type: "image/png" })

function stubFetch(response: Response | Error) {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      response instanceof Error
        ? Promise.reject(response)
        : Promise.resolve(response)
    )
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("verifyLabelRequest", () => {
  it("returns the verification result on success", async () => {
    const result = { overall: "pass", fields: [] }
    stubFetch(Response.json(result))
    await expect(verifyLabelRequest(application, image)).resolves.toEqual(
      result
    )
  })

  it("throws the server's error message with its retryable flag", async () => {
    stubFetch(
      Response.json(
        {
          error: "The AI service is rate limited. Try again in a moment.",
          retryable: true,
        },
        { status: 429 }
      )
    )
    const error = await verifyLabelRequest(application, image).catch((e) => e)
    expect(error).toBeInstanceOf(VerifyError)
    expect(error.message).toContain("rate limited")
    expect(error.retryable).toBe(true)
  })

  it("falls back to a generic message when the error body is not JSON", async () => {
    stubFetch(new Response("<html>Bad Gateway</html>", { status: 502 }))
    const error = await verifyLabelRequest(application, image).catch((e) => e)
    expect(error).toBeInstanceOf(VerifyError)
    expect(error.message).toContain("502")
  })

  it("throws a retryable error when the network request fails", async () => {
    stubFetch(new TypeError("Failed to fetch"))
    const error = await verifyLabelRequest(application, image).catch((e) => e)
    expect(error).toBeInstanceOf(VerifyError)
    expect(error.retryable).toBe(true)
  })

  it("throws instead of returning null when a 200 response has an unparseable body", async () => {
    stubFetch(new Response("not json", { status: 200 }))
    const error = await verifyLabelRequest(application, image).catch((e) => e)
    expect(error).toBeInstanceOf(VerifyError)
  })
})
