import { describe, expect, it } from "vitest";

import { parseBatchCsv } from "./batch";

const HEADER = "filename,brandName,classType,alcoholPercent,netContents";

describe("parseBatchCsv", () => {
  it("parses well-formed rows", () => {
    const csv = [
      HEADER,
      "old-tom.png,OLD TOM DISTILLERY,Kentucky Straight Bourbon Whiskey,45,750 mL",
      "ridge.png,SILVER RIDGE,Vodka,40,1 L",
    ].join("\n");

    const { rows, errors } = parseBatchCsv(csv);
    expect(errors).toHaveLength(0);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      filename: "old-tom.png",
      application: {
        brandName: "OLD TOM DISTILLERY",
        classType: "Kentucky Straight Bourbon Whiskey",
        alcoholPercent: 45,
        netContents: "750 mL",
      },
    });
  });

  it("handles quoted fields containing commas and quotes", () => {
    const csv = [
      HEADER,
      `stone.png,"Stone's Throw, Reserve","Red Wine, Estate Bottled",13.5,750 mL`,
    ].join("\n");

    const { rows, errors } = parseBatchCsv(csv);
    expect(errors).toHaveLength(0);
    expect(rows[0].application.brandName).toBe("Stone's Throw, Reserve");
  });

  it("handles escaped double quotes inside quoted fields", () => {
    const csv = [HEADER, `a.png,"The ""Old"" House",Gin,40,750 mL`].join("\n");
    const { rows } = parseBatchCsv(csv);
    expect(rows[0].application.brandName).toBe(`The "Old" House`);
  });

  it("accepts headers in any order", () => {
    const csv = [
      "brandName,netContents,filename,alcoholPercent,classType",
      "OLD TOM,750 mL,old-tom.png,45,Bourbon",
    ].join("\n");
    const { rows, errors } = parseBatchCsv(csv);
    expect(errors).toHaveLength(0);
    expect(rows[0].filename).toBe("old-tom.png");
    expect(rows[0].application.alcoholPercent).toBe(45);
  });

  it("reports per-row errors with line numbers and keeps good rows", () => {
    const csv = [
      HEADER,
      "good.png,OLD TOM,Bourbon,45,750 mL",
      "bad.png,,Bourbon,45,750 mL", // missing brand
      "worse.png,SILVER,Vodka,not-a-number,1 L", // bad percentage
    ].join("\n");

    const { rows, errors } = parseBatchCsv(csv);
    expect(rows).toHaveLength(1);
    expect(errors).toHaveLength(2);
    expect(errors[0].line).toBe(3);
    expect(errors[1].line).toBe(4);
  });

  it("skips blank lines and tolerates CRLF endings", () => {
    const csv = `${HEADER}\r\n\r\ngood.png,OLD TOM,Bourbon,45,750 mL\r\n`;
    const { rows, errors } = parseBatchCsv(csv);
    expect(errors).toHaveLength(0);
    expect(rows).toHaveLength(1);
  });

  it("fails clearly when required headers are missing", () => {
    const { rows, errors } = parseBatchCsv("a,b,c\n1,2,3");
    expect(rows).toHaveLength(0);
    expect(errors[0].message).toContain("filename");
  });

  it("returns nothing for an empty file", () => {
    const { rows, errors } = parseBatchCsv("");
    expect(rows).toHaveLength(0);
    expect(errors).toHaveLength(1);
  });
});
