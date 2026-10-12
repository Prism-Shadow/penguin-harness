/**
 * Placing a Benchmark under its id (state/project-benchmarks.ts placeBenchmark): what seeding and
 * the server's zip import write through.
 *
 * - A copy that another writer gets under the id while this one is still being written fails the
 *   placement with EEXIST on every platform; the other copy stays as it is, and nothing is left in
 *   staging.
 * - A replacement takes the id's directory whole, and leaves nothing in staging either.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { placeBenchmark } from "../src/state/index.js";

const ID = "report-writing-v1";

let dir: string;

beforeEach(async () => {
  dir = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "penguin-place-bench-")), "benchmarks");
  await fs.mkdir(dir);
});

afterEach(async () => {
  await fs.rm(path.dirname(dir), { recursive: true, force: true });
});

async function writePackage(benchDir: string, manifest: string): Promise<void> {
  await fs.writeFile(path.join(benchDir, "benchmark_config.toml"), manifest);
  await fs.mkdir(path.join(benchDir, "CASE-001", "statement"), { recursive: true });
  await fs.writeFile(path.join(benchDir, "CASE-001", "statement", "README.md"), "# A case\n");
}

describe("placing a Benchmark", () => {
  it("fails with EEXIST when another writer's copy takes the id first, and leaves that copy", async () => {
    const placing = placeBenchmark(dir, ID, async (stage) => {
      await writePackage(stage, "ours\n");
      // Another import of the same id lands while this copy is still being written.
      await fs.mkdir(path.join(dir, ID));
      await writePackage(path.join(dir, ID), "theirs\n");
    });

    await expect(placing).rejects.toMatchObject({ code: "EEXIST" });
    expect(await fs.readFile(path.join(dir, ID, "benchmark_config.toml"), "utf8")).toBe("theirs\n");
    expect(await fs.readdir(dir)).toEqual([ID]);
  });

  it("with replace, takes the id's directory whole", async () => {
    await fs.mkdir(path.join(dir, ID, ".jobs"), { recursive: true });
    await writePackage(path.join(dir, ID), "old\n");
    await fs.writeFile(path.join(dir, ID, "scoreboard.yaml"), "evaluations: []\n");

    await placeBenchmark(dir, ID, (stage) => writePackage(stage, "new\n"), { replace: true });

    expect(await fs.readFile(path.join(dir, ID, "benchmark_config.toml"), "utf8")).toBe("new\n");
    expect((await fs.readdir(path.join(dir, ID))).sort()).toEqual([
      "CASE-001",
      "benchmark_config.toml",
    ]);
    expect(await fs.readdir(dir)).toEqual([ID]);
  });
});
