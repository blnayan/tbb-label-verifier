import { describe, expect, it } from "vitest";

import { runPool } from "./pool";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("runPool", () => {
  it("runs every task and preserves input order in the results", async () => {
    const results = await runPool(
      [1, 2, 3, 4, 5],
      async (n) => {
        await sleep((6 - n) * 2); // later tasks finish sooner
        return n * 10;
      },
      2,
    );
    expect(results).toEqual([10, 20, 30, 40, 50]);
  });

  it("never exceeds the concurrency limit", async () => {
    let active = 0;
    let peak = 0;
    await runPool(
      Array.from({ length: 10 }, (_, i) => i),
      async () => {
        active++;
        peak = Math.max(peak, active);
        await sleep(5);
        active--;
      },
      3,
    );
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1); // it actually parallelizes
  });

  it("a rejected task surfaces as an Error result without stopping the rest", async () => {
    const results = await runPool(
      [1, 2, 3],
      async (n) => {
        if (n === 2) throw new Error("boom");
        return n;
      },
      2,
    );
    expect(results[0]).toBe(1);
    expect(results[1]).toBeInstanceOf(Error);
    expect(results[2]).toBe(3);
  });

  it("reports progress as tasks settle", async () => {
    const seen: number[] = [];
    await runPool([1, 2, 3], async (n) => n, 2, (done) => seen.push(done));
    expect(seen).toEqual([1, 2, 3]);
  });

  it("handles an empty input", async () => {
    expect(await runPool([], async (n) => n, 4)).toEqual([]);
  });
});
