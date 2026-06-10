/**
 * Tiny promise pool for batch verification: N labels verified in parallel,
 * capped so a 300-label dump doesn't open 300 simultaneous requests.
 */

export async function runPool<T, R>(
  items: readonly T[],
  worker: (item: T, index: number) => Promise<R>,
  concurrency: number,
  onProgress?: (completed: number, total: number) => void,
): Promise<(R | Error)[]> {
  const results = new Array<R | Error>(items.length);
  let next = 0;
  let completed = 0;

  async function lane(): Promise<void> {
    while (next < items.length) {
      const index = next++;
      try {
        results[index] = await worker(items[index], index);
      } catch (error) {
        results[index] =
          error instanceof Error ? error : new Error(String(error));
      }
      completed++;
      onProgress?.(completed, items.length);
    }
  }

  const lanes = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: lanes }, lane));
  return results;
}
