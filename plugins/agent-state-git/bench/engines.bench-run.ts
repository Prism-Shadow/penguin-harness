/**
 * `pnpm --filter @penguinharness/agent-state-git bench`: the built-in engine against this
 * plugin's, through the server's own Agent State repository, on the steps a workbench pays for.
 *
 * For a workbench of N files (5 to 500, about 2 KB each, ten to a folder), each engine handed
 * every step whatever the size (the harness itself hands this engine a step only from the sizes
 * its `fasterFrom` gives, which these figures set — src/engine.ts):
 *   first      the first commit of the folder, into a new repository
 *   unchanged  a load whose files did not change (nothing is written)
 *   changed    a load with one file changed
 *   history    listing the versions
 *   restore    reading a listed version's files back
 *
 * Each figure is the median of several runs, in milliseconds. A step the harness keeps
 * in-process whatever the engine (unchanged, history) is measured all the same, to show it. The
 * table ends with what one git process costs on this host before it does anything (`git version`).
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runGit } from "../src/git.js";
import { liveGit, QUIET, server } from "../test/live-git.js";

const live = await liveGit();
const REL = "workbenches/bench";
const RUNS = 9;

const files = (n: number, salt = "") =>
  Array.from({ length: n }, (_, i) => ({
    rel: `dir${Math.floor(i / 10)}/file-${i}.ts`,
    body: Buffer.from(`// ${salt}${i}\n${"export const value = 'x';\n".repeat(80)}`),
  }));

const median = (values: number[]) => [...values].sort((a, b) => a - b)[values.length >> 1]!;
const time = async (step: () => Promise<unknown>) => {
  const start = performance.now();
  await step();
  return performance.now() - start;
};

describe.skipIf(live === null)("engines, step by step", () => {
  it("prints the table", { timeout: 600_000 }, async () => {
    const rows: string[] = [];
    let now = new Date("2026-11-19T00:00:00Z");
    const clock = () => (now = new Date(now.getTime() + 1000));
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "agent-state-bench-"));
    try {
      for (const n of [5, 20, 50, 100, 200, 500]) {
        for (const [name, engine] of [
          ["built-in", server.builtinEngine],
          [live!.engine.name, live!.engine],
        ] as const) {
          let made = 0;
          const open = () => {
            made += 1;
            return path.join(root, `${n}-${name.replace(/\W+/g, "-")}-${made}.git`);
          };
          const repoAt = (gitdir: string) =>
            new server.AgentStateRepo({
              gitdir,
              now: clock,
              log: () => {},
              engine,
              engineFrom: { commit: 1, read: 1 },
              identity: QUIET,
            });
          const first: number[] = [];
          for (let run = 0; run < 5; run++) {
            const repo = repoAt(open());
            first.push(await time(() => repo.commitPath(REL, files(n), "first")));
          }
          const repo = repoAt(open());
          const base = files(n);
          await repo.commitPath(REL, base, "base");
          const unchanged: number[] = [];
          for (let run = 0; run < RUNS; run++) {
            unchanged.push(await time(() => repo.commitPath(REL, base, "again")));
          }
          const changed: number[] = [];
          for (let run = 0; run < RUNS; run++) {
            const edited = files(n);
            edited[run % n] = { ...edited[run % n]!, body: Buffer.from(`// edit ${run}\n`) };
            changed.push(await time(() => repo.commitPath(REL, edited, `edit ${run}`)));
          }
          const history: number[] = [];
          for (let run = 0; run < RUNS; run++) history.push(await time(() => repo.history(REL)));
          const versions = await repo.history(REL);
          const restore: number[] = [];
          for (let run = 0; run < RUNS; run++) {
            const at = versions[versions.length - 1]!.revision;
            restore.push(
              await time(async () => expect((await repo.filesAt(REL, at))?.length).toBe(n)),
            );
          }
          const ms = (v: number[]) => median(v).toFixed(1);
          rows.push(
            `| ${name} | ${n} | ${ms(first)} | ${ms(unchanged)} | ${ms(changed)} | ${ms(history)} | ${ms(restore)} |`,
          );
        }
      }
      const spawn: number[] = [];
      for (let run = 0; run < RUNS; run++) {
        spawn.push(await time(() => runGit(live!.git, root, ["version"])));
      }
      rows.push(`\nOne git process (\`git version\`): ${median(spawn).toFixed(1)} ms`);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
    console.log(
      [
        `Agent State engines on ${process.platform}-${process.arch}, ${os.cpus().length} CPUs, median ms`,
        "| Engine | Files | First commit | Load, unchanged | Load, one file changed | History | Restore |",
        "| --- | --- | --- | --- | --- | --- | --- |",
        ...rows,
      ].join("\n"),
    );
  });
});
