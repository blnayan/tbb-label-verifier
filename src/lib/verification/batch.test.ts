import { readFileSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { parseBatchCsv } from "./batch"

const HEADER =
  "filename,brandName,classType,alcoholPercent,netContents,bottlerNameAddress"

describe("parseBatchCsv", () => {
  it("parses well-formed rows", () => {
    const csv = [
      HEADER,
      `old-tom.png,OLD TOM DISTILLERY,Kentucky Straight Bourbon Whiskey,45,750 mL,"Old Tom Distillery, Bardstown, KY"`,
      `ridge.png,SILVER RIDGE,Vodka,40,1 L,"Silver Ridge Distilling Co., Boise, ID"`,
    ].join("\n")

    const { rows, errors } = parseBatchCsv(csv)
    expect(errors).toHaveLength(0)
    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual({
      filename: "old-tom.png",
      application: {
        brandName: "OLD TOM DISTILLERY",
        classType: "Kentucky Straight Bourbon Whiskey",
        alcoholPercent: 45,
        netContents: "750 mL",
        bottlerNameAddress: "Old Tom Distillery, Bardstown, KY",
      },
    })
  })

  it("handles quoted fields containing commas and quotes", () => {
    const csv = [
      HEADER,
      `stone.png,"Stone's Throw, Reserve","Red Wine, Estate Bottled",13.5,750 mL,"Stone Cellars, Walla Walla, WA"`,
    ].join("\n")

    const { rows, errors } = parseBatchCsv(csv)
    expect(errors).toHaveLength(0)
    expect(rows[0].application.brandName).toBe("Stone's Throw, Reserve")
  })

  it("handles escaped double quotes inside quoted fields", () => {
    const csv = [
      HEADER,
      `a.png,"The ""Old"" House",Gin,40,750 mL,Acme Gin Co. Portland OR`,
    ].join("\n")
    const { rows } = parseBatchCsv(csv)
    expect(rows[0].application.brandName).toBe(`The "Old" House`)
  })

  it("accepts headers in any order", () => {
    const csv = [
      "brandName,netContents,filename,bottlerNameAddress,alcoholPercent,classType",
      "OLD TOM,750 mL,old-tom.png,Old Tom Distillery Bardstown KY,45,Bourbon",
    ].join("\n")
    const { rows, errors } = parseBatchCsv(csv)
    expect(errors).toHaveLength(0)
    expect(rows[0].filename).toBe("old-tom.png")
    expect(rows[0].application.alcoholPercent).toBe(45)
  })

  it("reports per-row errors with line numbers and keeps good rows", () => {
    const csv = [
      HEADER,
      "good.png,OLD TOM,Bourbon,45,750 mL,Old Tom Distillery Bardstown KY",
      "bad.png,,Bourbon,45,750 mL,Old Tom Distillery Bardstown KY", // missing brand
      "worse.png,SILVER,Vodka,not-a-number,1 L,Silver Ridge Boise ID", // bad percentage
    ].join("\n")

    const { rows, errors } = parseBatchCsv(csv)
    expect(rows).toHaveLength(1)
    expect(errors).toHaveLength(2)
    expect(errors[0].line).toBe(3)
    expect(errors[1].line).toBe(4)
  })

  it("rejects rows with a blank bottler name/address", () => {
    const csv = [
      HEADER,
      "good.png,OLD TOM,Bourbon,45,750 mL,Old Tom Distillery Bardstown KY",
      "no-bottler.png,SILVER,Vodka,40,750 mL,", // blank bottler cell
    ].join("\n")

    const { rows, errors } = parseBatchCsv(csv)
    expect(rows).toHaveLength(1)
    expect(errors).toHaveLength(1)
    expect(errors[0].line).toBe(3)
    expect(errors[0].message.toLowerCase()).toContain("name and address")
  })

  it("skips blank lines and tolerates CRLF endings", () => {
    const csv = `${HEADER}\r\n\r\ngood.png,OLD TOM,Bourbon,45,750 mL,Old Tom Distillery Bardstown KY\r\n`
    const { rows, errors } = parseBatchCsv(csv)
    expect(errors).toHaveLength(0)
    expect(rows).toHaveLength(1)
  })

  it("fails clearly when required headers are missing", () => {
    const { rows, errors } = parseBatchCsv("a,b,c\n1,2,3")
    expect(rows).toHaveLength(0)
    expect(errors[0].message).toContain("filename")
  })

  it("fails clearly when the bottlerNameAddress column is missing", () => {
    const csv = [
      "filename,brandName,classType,alcoholPercent,netContents",
      "old-tom.png,OLD TOM,Bourbon,45,750 mL",
    ].join("\n")
    const { rows, errors } = parseBatchCsv(csv)
    expect(rows).toHaveLength(0)
    expect(errors[0].message).toContain("bottlerNameAddress")
  })

  it("returns nothing for an empty file", () => {
    const { rows, errors } = parseBatchCsv("")
    expect(rows).toHaveLength(0)
    expect(errors).toHaveLength(1)
  })

  it("parses the optional countryOfOrigin column", () => {
    const csv = [
      `${HEADER},countryOfOrigin`,
      `tsarine.png,TSARINE,Champagne,12,750 mL,"Champagne Tsarine, Reims",France`,
    ].join("\n")

    const { rows, errors } = parseBatchCsv(csv)
    expect(errors).toHaveLength(0)
    expect(rows[0].application.bottlerNameAddress).toBe(
      "Champagne Tsarine, Reims"
    )
    expect(rows[0].application.countryOfOrigin).toBe("France")
  })

  it("treats a blank countryOfOrigin cell as omitted", () => {
    const csv = [
      `${HEADER},countryOfOrigin`,
      "old-tom.png,OLD TOM,Bourbon,45,750 mL,Old Tom Distillery Bardstown KY,",
    ].join("\n")

    const { rows, errors } = parseBatchCsv(csv)
    expect(errors).toHaveLength(0)
    expect(rows[0].application.countryOfOrigin).toBeUndefined()
  })

  it("enforces the imported flag per row when the column is present", () => {
    const csv = [
      `${HEADER},imported,countryOfOrigin`,
      "tsarine.png,TSARINE,Champagne,12,750 mL,Tsarine Reims,yes,France",
      "forgot-country.png,BRAND,Vodka,40,750 mL,Acme Spirits Denver CO,yes,", // imported but no country
      "old-tom.png,OLD TOM,Bourbon,45,750 mL,Old Tom Distillery Bardstown KY,no,",
    ].join("\n")

    const { rows, errors } = parseBatchCsv(csv)
    expect(rows).toHaveLength(2)
    expect(rows[0].application.countryOfOrigin).toBe("France")
    expect(rows[1].application.countryOfOrigin).toBeUndefined()
    expect(errors).toHaveLength(1)
    expect(errors[0].line).toBe(3)
    expect(errors[0].message).toContain("Country of origin")
  })

  it("parses the shipped sample CSV without errors", () => {
    const csv = readFileSync(
      join(process.cwd(), "public/samples/batch.csv"),
      "utf8"
    )
    const { rows, errors } = parseBatchCsv(csv)
    expect(errors).toHaveLength(0)
    expect(rows).toHaveLength(32)
    // Every application carries its bottler statement; the dataset must
    // also exercise the country-of-origin check.
    expect(rows.every((r) => r.application.bottlerNameAddress)).toBe(true)
    expect(rows.some((r) => r.application.countryOfOrigin)).toBe(true)
  })
})
