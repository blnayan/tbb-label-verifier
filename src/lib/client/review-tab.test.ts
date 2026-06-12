import { describe, expect, it } from "vitest"

import {
  parseReviewTab,
  reportHref,
  verificationsHref,
} from "@/lib/client/review-tab"

describe("parseReviewTab", () => {
  it("accepts each real tab", () => {
    expect(parseReviewTab("pending")).toBe("pending")
    expect(parseReviewTab("approved")).toBe("approved")
    expect(parseReviewTab("rejected")).toBe("rejected")
    expect(parseReviewTab("all")).toBe("all")
  })

  it("falls back to the All tab when the param is missing", () => {
    expect(parseReviewTab(null)).toBe("all")
  })

  it("falls back to the All tab on a value that is not a tab", () => {
    expect(parseReviewTab("garbage")).toBe("all")
    expect(parseReviewTab("")).toBe("all")
    expect(parseReviewTab("PENDING")).toBe("all")
  })
})

describe("verificationsHref", () => {
  it("keeps the default All tab out of the URL", () => {
    expect(verificationsHref("all")).toBe("/verifications")
  })

  it("carries any other tab as a query param", () => {
    expect(verificationsHref("pending")).toBe("/verifications?tab=pending")
    expect(verificationsHref("approved")).toBe("/verifications?tab=approved")
    expect(verificationsHref("rejected")).toBe("/verifications?tab=rejected")
  })
})

describe("reportHref", () => {
  it("links straight to the report from the default tab", () => {
    expect(reportHref("abc123", "all")).toBe("/verifications/abc123")
  })

  it("carries the originating tab so the report can send the user back", () => {
    expect(reportHref("abc123", "pending")).toBe(
      "/verifications/abc123?tab=pending"
    )
  })

  it("escapes ids that are not URL-safe", () => {
    expect(reportHref("a/b c", "pending")).toBe(
      "/verifications/a%2Fb%20c?tab=pending"
    )
  })
})
