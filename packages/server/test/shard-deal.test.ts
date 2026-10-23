/**
 * How the Windows shards split the suite (test/setup/shard-deal.ts, used by `--shard`).
 *
 * - Given files and their weights, every file lands in exactly one shard, including a file the
 *   weights do not name.
 * - Given the heaviest files, no two of them share a shard while there are shards to spare, and
 *   the shards' totals come out close.
 * - Given the same files listed in another order (another job of the run), the deal is the same.
 */
import { describe, expect, it } from "vitest";
import { dealByWeight } from "./setup/shard-deal";

const WEIGHTS = {
  "test/workbenches.test.ts": 51,
  "test/schedules.test.ts": 47,
  "test/builtin-agents.test.ts": 37,
  "test/a.test.ts": 3,
  "test/b.test.ts": 3,
  "test/c.test.ts": 2,
  "test/d.test.ts": 2,
  "test/e.test.ts": 1,
};
const FILES = [...Object.keys(WEIGHTS), "test/new.test.ts"];
const load = (shard: string[]) =>
  shard.reduce((sum, file) => sum + (WEIGHTS[file as keyof typeof WEIGHTS] ?? 2.5), 0);

describe("dealing the suite into shards", () => {
  it("puts every file in exactly one shard, a file the weights do not name included", () => {
    const shards = dealByWeight(FILES, 3, WEIGHTS);
    expect(shards).toHaveLength(3);
    expect(shards.flat().sort()).toEqual([...FILES].sort());
  });

  it("spreads the heaviest files and keeps the totals close", () => {
    const shards = dealByWeight(FILES, 3, WEIGHTS);
    for (const shard of shards) {
      const heavy = shard.filter((file) => (WEIGHTS[file as keyof typeof WEIGHTS] ?? 0) > 30);
      expect(heavy).toHaveLength(1);
    }
    const loads = shards.map(load);
    expect(Math.max(...loads) - Math.min(...loads)).toBeLessThanOrEqual(10);
  });

  it("deals the same whatever order the files are listed in", () => {
    expect(dealByWeight([...FILES].reverse(), 4, WEIGHTS)).toEqual(dealByWeight(FILES, 4, WEIGHTS));
  });
});
