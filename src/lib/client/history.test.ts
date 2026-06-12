import { IDBFactory } from "fake-indexeddb"
import { beforeEach, describe, expect, it } from "vitest"

import type {
  LabelExtraction,
  VerificationResult,
} from "@/lib/verification/types"

import {
  clearVerifications,
  getVerification,
  listVerifications,
  reviewVerification,
  saveVerification,
  subscribeToVerifications,
  type NewVerificationRecord,
} from "./history"

const EXTRACTION: LabelExtraction = {
  isAlcoholLabel: true,
  readability: "clear",
  brandName: "OLD TOM DISTILLERY",
  classType: "Kentucky Straight Bourbon Whiskey",
  alcoholStatement: "45% ALC./VOL.",
  netContents: "750 mL",
  nameAndAddress: "Bottled by Old Tom Distillery, Bardstown, KY",
  countryOfOrigin: null,
  governmentWarning: {
    present: true,
    verbatimText: "GOVERNMENT WARNING: …",
    headingAllCaps: true,
    headingAppearsBold: true,
  },
  imageQualityNotes: null,
}

const RESULT: VerificationResult = {
  overall: "pass",
  fields: [
    {
      field: "brandName",
      status: "match",
      expected: "OLD TOM DISTILLERY",
      found: "OLD TOM DISTILLERY",
      note: null,
    },
  ],
  extraction: EXTRACTION,
  extractionMs: 3200,
  model: "gpt-5.4-mini",
}

function makeRecord(
  overrides: Partial<NewVerificationRecord> = {}
): NewVerificationRecord {
  return {
    source: "single",
    filename: "old-tom.jpg",
    application: {
      brandName: "OLD TOM DISTILLERY",
      classType: "Kentucky Straight Bourbon Whiskey",
      alcoholPercent: 45,
      netContents: "750 mL",
      bottlerNameAddress: "Old Tom Distillery, Bardstown, KY",
    },
    result: RESULT,
    image: new Blob(["fake-image-bytes"], { type: "image/jpeg" }),
    ...overrides,
  }
}

beforeEach(() => {
  // A fresh IndexedDB per test — no cross-test contamination.
  globalThis.indexedDB = new IDBFactory()
})

describe("saveVerification", () => {
  it("assigns an id and a creation timestamp", async () => {
    const saved = await saveVerification(makeRecord())
    expect(saved.id).toBeTruthy()
    expect(saved.createdAt).toBeGreaterThan(0)
  })

  it("assigns distinct ids to separate saves", async () => {
    const a = await saveVerification(makeRecord())
    const b = await saveVerification(makeRecord())
    expect(a.id).not.toBe(b.id)
  })

  it("auto-approves a passing verification", async () => {
    const saved = await saveVerification(makeRecord())
    expect(saved.review).toEqual({
      state: "approved",
      mode: "auto",
      reviewedAt: expect.any(Number),
    })
  })

  it("auto-rejects a failing verification — the rules already decided", async () => {
    const saved = await saveVerification(
      makeRecord({ result: { ...RESULT, overall: "fail" } })
    )
    expect(saved.review).toEqual({
      state: "rejected",
      mode: "auto",
      reviewedAt: expect.any(Number),
    })
  })

  it.each(["needs_review", "unreadable"] as const)(
    "queues a %s verification for manual review",
    async (overall) => {
      const saved = await saveVerification(
        makeRecord({ result: { ...RESULT, overall } })
      )
      expect(saved.review).toEqual({
        state: "pending",
        mode: null,
        reviewedAt: null,
      })
    }
  )
})

describe("getVerification", () => {
  it("returns the stored record for an id", async () => {
    await saveVerification(makeRecord({ filename: "other.jpg" }))
    const saved = await saveVerification(makeRecord())

    // The store adds its internal sequence key on read, so subset-match.
    const found = await getVerification(saved.id)
    expect(found).toMatchObject(saved)
  })

  it("returns null for an id that does not exist", async () => {
    await saveVerification(makeRecord())
    expect(await getVerification("no-such-id")).toBeNull()
  })

  it("reflects a later review decision", async () => {
    const saved = await saveVerification(
      makeRecord({ result: { ...RESULT, overall: "needs_review" } })
    )
    await reviewVerification(saved.id, "approved")

    const found = await getVerification(saved.id)
    expect(found?.review.state).toBe("approved")
    expect(found?.review.mode).toBe("manual")
  })
})

describe("listVerifications", () => {
  it("returns an empty list when nothing has been saved", async () => {
    expect(await listVerifications()).toEqual([])
  })

  it("round-trips a record, including the image blob", async () => {
    const saved = await saveVerification(makeRecord())
    const [listed] = await listVerifications()
    expect(listed.id).toBe(saved.id)
    expect(listed.filename).toBe("old-tom.jpg")
    expect(listed.source).toBe("single")
    expect(listed.application.brandName).toBe("OLD TOM DISTILLERY")
    expect(listed.result.overall).toBe("pass")
    expect(listed.image).toBeInstanceOf(Blob)
    expect(await listed.image.text()).toBe("fake-image-bytes")
  })

  it("returns newest records first", async () => {
    const first = await saveVerification(makeRecord({ filename: "a.jpg" }))
    const second = await saveVerification(makeRecord({ filename: "b.jpg" }))
    // Saves within the same millisecond must still order: newest first.
    const ids = (await listVerifications()).map((r) => r.id)
    expect(ids.indexOf(second.id)).toBeLessThan(ids.indexOf(first.id))
  })
})

describe("reviewVerification", () => {
  it("records a manual approval and persists it", async () => {
    const saved = await saveVerification(
      makeRecord({ result: { ...RESULT, overall: "needs_review" } })
    )
    const reviewed = await reviewVerification(saved.id, "approved")
    expect(reviewed.review).toEqual({
      state: "approved",
      mode: "manual",
      reviewedAt: expect.any(Number),
    })
    const [listed] = await listVerifications()
    expect(listed.review).toEqual(reviewed.review)
  })

  it("records a manual rejection", async () => {
    const saved = await saveVerification(
      makeRecord({ result: { ...RESULT, overall: "fail" } })
    )
    const reviewed = await reviewVerification(saved.id, "rejected")
    expect(reviewed.review.state).toBe("rejected")
    expect(reviewed.review.mode).toBe("manual")
  })

  it("lets a revisit change an earlier decision", async () => {
    const saved = await saveVerification(
      makeRecord({ result: { ...RESULT, overall: "needs_review" } })
    )
    await reviewVerification(saved.id, "rejected")
    await reviewVerification(saved.id, "approved")
    const [listed] = await listVerifications()
    expect(listed.review.state).toBe("approved")
    expect(listed.review.mode).toBe("manual")
  })

  it("rejects an unknown id", async () => {
    await expect(reviewVerification("no-such-id", "approved")).rejects.toThrow()
  })
})

describe("clearVerifications", () => {
  it("removes every stored record", async () => {
    await saveVerification(makeRecord())
    await saveVerification(makeRecord())
    await clearVerifications()
    expect(await listVerifications()).toEqual([])
  })

  it("is a no-op on an empty store", async () => {
    await expect(clearVerifications()).resolves.toBeUndefined()
    expect(await listVerifications()).toEqual([])
  })
})

describe("subscribeToVerifications", () => {
  it("notifies on save, review decision, and clear — until unsubscribed", async () => {
    let calls = 0
    const unsubscribe = subscribeToVerifications(() => calls++)

    const saved = await saveVerification(
      makeRecord({ result: { ...RESULT, overall: "needs_review" } })
    )
    expect(calls).toBe(1)

    await reviewVerification(saved.id, "approved")
    expect(calls).toBe(2)

    await clearVerifications()
    expect(calls).toBe(3)

    unsubscribe()
    await saveVerification(makeRecord())
    expect(calls).toBe(3)
  })
})

describe("schema migrations", () => {
  /** Build an old-version database and seed it with raw records. */
  function seedOldDb(version: 1 | 2, records: object[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const open = indexedDB.open("ttb-label-verifier", version)
      open.onupgradeneeded = () => {
        const store = open.result.createObjectStore("verifications", {
          keyPath: "seq",
          autoIncrement: true,
        })
        if (version >= 2) store.createIndex("id", "id", { unique: true })
      }
      open.onsuccess = () => {
        const db = open.result
        const tx = db.transaction("verifications", "readwrite")
        for (const record of records)
          tx.objectStore("verifications").add(record)
        tx.oncomplete = () => {
          db.close()
          resolve()
        }
        tx.onerror = () => reject(tx.error)
      }
      open.onerror = () => reject(open.error)
    })
  }

  const raw = (overall: VerificationResult["overall"], filename: string) => ({
    ...makeRecord({ result: { ...RESULT, overall }, filename }),
    id: crypto.randomUUID(),
    createdAt: Date.now(),
  })

  it("backfills review state on v1 records (no review field)", async () => {
    await seedOldDb(1, [raw("pass", "passed.jpg"), raw("fail", "failed.jpg")])

    const records = await listVerifications()
    const passed = records.find((r) => r.filename === "passed.jpg")
    const failed = records.find((r) => r.filename === "failed.jpg")
    expect(passed?.review.state).toBe("approved")
    expect(passed?.review.mode).toBe("auto")
    expect(failed?.review.state).toBe("rejected")
    expect(failed?.review.mode).toBe("auto")
    // The migrated store supports manual review (the id index exists).
    await expect(
      reviewVerification(failed!.id, "approved")
    ).resolves.toBeTruthy()
  })

  it("auto-rejects v2 records left pending on a fail verdict", async () => {
    await seedOldDb(2, [
      {
        ...raw("fail", "pending-fail.jpg"),
        review: { state: "pending", mode: null, reviewedAt: null },
      },
      {
        ...raw("needs_review", "pending-close.jpg"),
        review: { state: "pending", mode: null, reviewedAt: null },
      },
      {
        ...raw("fail", "manually-approved.jpg"),
        review: { state: "approved", mode: "manual", reviewedAt: 123 },
      },
    ])

    const records = await listVerifications()
    const pendingFail = records.find((r) => r.filename === "pending-fail.jpg")
    const pendingClose = records.find((r) => r.filename === "pending-close.jpg")
    const manual = records.find((r) => r.filename === "manually-approved.jpg")
    // Pending fails adopt the new auto-reject semantics…
    expect(pendingFail?.review.state).toBe("rejected")
    expect(pendingFail?.review.mode).toBe("auto")
    // …while genuine ambiguity stays queued and human decisions are kept.
    expect(pendingClose?.review.state).toBe("pending")
    expect(manual?.review).toEqual({
      state: "approved",
      mode: "manual",
      reviewedAt: 123,
    })
  })
})
