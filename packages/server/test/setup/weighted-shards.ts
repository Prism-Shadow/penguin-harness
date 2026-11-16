/**
 * The server suite's `--shard`: files dealt by how long each takes on the Windows runner, where the
 * suite runs in three jobs, rather than by vitest's default hash of the path. The hash left one of
 * three Windows shards with 461 of the suite's 1022 test-seconds (workbenches, schedules and
 * builtin-agents landed together) against 281 and 280 for the other two. The Linux halves are dealt
 * by the same table: the slowest files are slow on both runners.
 *
 * The weights are test/shard-weights.json: seconds per file, as the Windows shards' logs report
 * them, averaged over several runs. A stale table only unbalances the shards; it never drops or
 * repeats a file (shard-deal.ts), and a file it does not name weighs the median. The suite grows,
 * so refresh it when a Windows server shard runs a minute longer than the others, from runs whose
 * `test-windows (server-N)` jobs all passed:
 *
 *   gh run view <run id> --log > run-1.log   # and a few more runs
 *   node packages/server/scripts/shard-weights.mjs run-1.log run-2.log run-3.log
 *
 * Ordering within a shard is vitest's own (`sort` is inherited).
 */
import path from "node:path";
import { BaseSequencer } from "vitest/node";
import type { TestSpecification } from "vitest/node";
import weights from "../shard-weights.json" with { type: "json" };
import { dealByWeight } from "./shard-deal";

/** A path relative to the project root with forward slashes, as the table names files. */
const slash = (p: string): string => p.replaceAll("\\", "/");

export class WeightedShards extends BaseSequencer {
  override async shard(specs: TestSpecification[]): Promise<TestSpecification[]> {
    const { root, shard } = this.ctx.config;
    if (!shard) return specs;
    const key = (spec: TestSpecification): string =>
      slash(path.relative(slash(root), slash(spec.moduleId)));
    const dealt = dealByWeight(specs.map(key), shard.count, weights);
    const mine = new Set(dealt[shard.index - 1]);
    return specs.filter((spec) => mine.has(key(spec)));
  }
}
