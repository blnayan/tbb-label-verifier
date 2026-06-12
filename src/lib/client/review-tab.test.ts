import { describe, expect, it } from "vitest"

import {
  nextReportHref,
  parseReviewTab,
  previousReportHref,
  reportHref,
  uploadReportHref,
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

describe("uploadReportHref", () => {
  it("marks the report as opened straight from an upload", () => {
    expect(uploadReportHref("abc123")).toBe("/verifications/abc123?from=upload")
  })

  it("escapes ids that are not URL-safe", () => {
    expect(uploadReportHref("a/b c")).toBe(
      "/verifications/a%2Fb%20c?from=upload"
    )
  })
})

describe("nextReportHref", () => {
  // Newest-first, like listVerifications(): a, b, c, d from newest to oldest.
  const records = [
    { id: "a", review: { state: "pending" } },
    { id: "b", review: { state: "approved" } },
    { id: "c", review: { state: "pending" } },
    { id: "d", review: { state: "rejected" } },
  ] as const

  it("finds the next record in the same tab, skipping other states", () => {
    expect(nextReportHref(records, "a", "pending")).toBe(
      "/verifications/c?tab=pending"
    )
  })

  it("walks the full list in order on the All tab", () => {
    expect(nextReportHref(records, "a", "all")).toBe("/verifications/b")
    expect(nextReportHref(records, "b", "all")).toBe("/verifications/c")
  })

  it("still advances after the current record left the tab", () => {
    // "b" was just approved off the pending queue: its own state no longer
    // matches, but the next pending record below it is still the answer.
    expect(nextReportHref(records, "b", "pending")).toBe(
      "/verifications/c?tab=pending"
    )
  })

  it("returns null when nothing in the tab comes after the current record", () => {
    expect(nextReportHref(records, "c", "pending")).toBeNull()
    expect(nextReportHref(records, "d", "all")).toBeNull()
  })

  it("returns null when the current record is not in the list", () => {
    expect(nextReportHref(records, "ghost", "all")).toBeNull()
  })

  it("never points back at the current record", () => {
    expect(nextReportHref(records, "d", "rejected")).toBeNull()
  })
})

describe("previousReportHref", () => {
  // Same fixture as nextReportHref: a, b, c, d from newest to oldest.
  const records = [
    { id: "a", review: { state: "pending" } },
    { id: "b", review: { state: "approved" } },
    { id: "c", review: { state: "pending" } },
    { id: "d", review: { state: "rejected" } },
  ] as const

  it("finds the previous record in the same tab, skipping other states", () => {
    expect(previousReportHref(records, "c", "pending")).toBe(
      "/verifications/a?tab=pending"
    )
  })

  it("walks the full list in order on the All tab", () => {
    expect(previousReportHref(records, "d", "all")).toBe("/verifications/c")
    expect(previousReportHref(records, "b", "all")).toBe("/verifications/a")
  })

  it("still steps back after the current record left the tab", () => {
    expect(previousReportHref(records, "b", "pending")).toBe(
      "/verifications/a?tab=pending"
    )
  })

  it("returns null when nothing in the tab comes before the current record", () => {
    expect(previousReportHref(records, "a", "pending")).toBeNull()
    expect(previousReportHref(records, "a", "all")).toBeNull()
  })

  it("returns null when the current record is not in the list", () => {
    expect(previousReportHref(records, "ghost", "all")).toBeNull()
  })

  it("never points back at the current record", () => {
    expect(previousReportHref(records, "d", "rejected")).toBeNull()
  })

  it("mirrors nextReportHref so Back undoes Next", () => {
    expect(previousReportHref(records, "c", "pending")).toBe(
      reportHref("a", "pending")
    )
    expect(nextReportHref(records, "a", "pending")).toBe(
      reportHref("c", "pending")
    )
  })
})
