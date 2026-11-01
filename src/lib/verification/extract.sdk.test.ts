/**
 * Contract tests against the real OpenAI SDK with `fetch` stubbed out: they
 * pin the request the extraction pipeline sends (model, effort, image
 * detail, strict JSON-schema format) and the SDK's structured-output
 * parsing, so an SDK upgrade that changes either fails here instead of in
 * production. No network access or API key is needed.
 */

import OpenAI from "openai"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { extractLabel, rereadWarning } from "./extract"
import type { LabelExtraction } from "./types"

const EXTRACTION: LabelExtraction = {
  isAlcoholLabel: true,
  readability: "clear",
  brandName: "OLD TOM DISTILLERY",
  classType: "Kentucky Straight Bourbon Whiskey",
  alcoholStatement: "45% Alc./Vol. (90 Proof)",
  netContents: "750 mL",
  nameAndAddress: "BOTTLED BY OLD TOM DISTILLERY, BARDSTOWN, KY",
  countryOfOrigin: null,
  governmentWarning: {
    present: true,
    verbatimText: "GOVERNMENT WARNING: (1) ...",
    headingAllCaps: true,
    headingAppearsBold: true,
  },
  imageQualityNotes: null,
}

/** A minimal completed Responses API payload whose output text is `json`. */
function responseBody(json: unknown) {
  return {
    id: "resp_test",
    object: "response",
    created_at: 1_700_000_000,
    status: "completed",
    model: "gpt-test",
    output: [
      {
        type: "message",
        id: "msg_test",
        role: "assistant",
        status: "completed",
        content: [
          { type: "output_text", text: JSON.stringify(json), annotations: [] },
        ],
      },
    ],
    parallel_tool_calls: true,
    tool_choice: "auto",
    tools: [],
  }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

const IMAGE = { imageBase64: "AAAA", mediaType: "image/png" as const }

// One stable mock: extract.ts caches its OpenAI client, and the SDK captures
// the global fetch when that client is constructed.
const fetchMock = vi.fn()

/** The JSON body of the n-th request the SDK sent. */
function sentBody(n = 0): Record<string, unknown> {
  const init = fetchMock.mock.calls[n][1] as RequestInit
  return JSON.parse(init.body as string)
}

beforeEach(() => {
  vi.stubEnv("OPENAI_API_KEY", "sk-test")
  vi.stubEnv("OPENAI_MODEL", "gpt-test")
  vi.stubEnv("OPENAI_REASONING_EFFORT", "")
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe("extractLabel (OpenAI SDK contract)", () => {
  it("sends a strict json_schema request and returns the parsed extraction", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(responseBody(EXTRACTION)))

    await expect(extractLabel(IMAGE)).resolves.toEqual(EXTRACTION)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(String(url)).toMatch(/\/v1\/responses$/)
    expect(init.method).toBe("POST")
    expect(new Headers(init.headers).get("authorization")).toBe(
      "Bearer sk-test"
    )

    const body = sentBody()
    expect(body.model).toBe("gpt-test")
    expect(body.max_output_tokens).toBe(4096)
    expect(body).not.toHaveProperty("reasoning")
    expect(body.input).toEqual([
      {
        role: "user",
        content: [
          {
            type: "input_image",
            image_url: "data:image/png;base64,AAAA",
            detail: "high",
          },
          expect.objectContaining({ type: "input_text" }),
        ],
      },
    ])
    const format = (body.text as { format: Record<string, unknown> }).format
    expect(format).toMatchObject({
      type: "json_schema",
      name: "label_extraction",
      strict: true,
    })
    // Strict mode requires every property to be listed as required.
    const schema = format.schema as {
      properties: Record<string, unknown>
      required: string[]
    }
    expect(schema.required.sort()).toEqual(
      Object.keys(schema.properties).sort()
    )
  })

  it("passes OPENAI_REASONING_EFFORT through as reasoning.effort", async () => {
    vi.stubEnv("OPENAI_REASONING_EFFORT", "none")
    fetchMock.mockResolvedValueOnce(jsonResponse(responseBody(EXTRACTION)))

    await extractLabel(IMAGE)

    expect(sentBody().reasoning).toEqual({ effort: "none" })
  })

  it("surfaces a rejected key as OpenAI.AuthenticationError (route maps it)", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        { error: { message: "bad key", type: "invalid_request_error" } },
        401
      )
    )

    await expect(extractLabel(IMAGE)).rejects.toBeInstanceOf(
      OpenAI.AuthenticationError
    )
    // 401 is not retried.
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe("rereadWarning (OpenAI SDK contract)", () => {
  it("parses the nested governmentWarning object", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(
        responseBody({ governmentWarning: EXTRACTION.governmentWarning })
      )
    )

    await expect(rereadWarning(IMAGE)).resolves.toEqual(
      EXTRACTION.governmentWarning
    )
    const format = (sentBody().text as { format: Record<string, unknown> })
      .format
    expect(format).toMatchObject({ name: "warning_reread", strict: true })
  })
})
