import { afterEach, describe, expect, it } from "vitest"

import {
  finishUpload,
  listInFlight,
  startUpload,
  subscribeToUploads,
} from "./uploads"

const APPLICATION = {
  brandName: "OLD TOM DISTILLERY",
  classType: "Kentucky Straight Bourbon Whiskey",
  alcoholPercent: 45,
  netContents: "750 mL",
  bottlerNameAddress: "Old Tom Distillery, Bardstown, KY",
}

function start(filename = "label.jpg") {
  return startUpload({
    source: "single" as const,
    filename,
    application: APPLICATION,
  })
}

afterEach(() => {
  for (const upload of listInFlight()) finishUpload(upload.id)
})

describe("startUpload / listInFlight", () => {
  it("tracks an upload with an id and start time", () => {
    const id = start()
    const [upload] = listInFlight()
    expect(upload.id).toBe(id)
    expect(upload.filename).toBe("label.jpg")
    expect(upload.source).toBe("single")
    expect(upload.application.brandName).toBe("OLD TOM DISTILLERY")
    expect(upload.createdAt).toBeGreaterThan(0)
  })

  it("lists newest first", () => {
    const first = start("a.jpg")
    const second = start("b.jpg")
    const ids = listInFlight().map((u) => u.id)
    expect(ids.indexOf(second)).toBeLessThan(ids.indexOf(first))
  })
})

describe("finishUpload", () => {
  it("removes the upload", () => {
    const id = start()
    finishUpload(id)
    expect(listInFlight()).toEqual([])
  })

  it("is a no-op for an unknown id", () => {
    start()
    finishUpload("no-such-id")
    expect(listInFlight()).toHaveLength(1)
  })
})

describe("subscribeToUploads", () => {
  it("notifies on start and finish until unsubscribed", () => {
    let calls = 0
    const unsubscribe = subscribeToUploads(() => calls++)
    const id = start()
    expect(calls).toBe(1)
    finishUpload(id)
    expect(calls).toBe(2)
    unsubscribe()
    start()
    expect(calls).toBe(2)
  })
})
