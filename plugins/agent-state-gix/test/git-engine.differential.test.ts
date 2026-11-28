/**
 * Differential Testing Gate: `gixGitEngine` (Rust gitoxide AsyncTask) vs `gitclGitEngine`
 * (pure-plumbing host Git CLI) under the unified `GitEngine` / `GitRepo` contract.
 *
 * Four layers:
 * 1. Deterministic edge-case & structured GitError.code parity (file streaming, patch, modes,
 *    timezones, empty trees, no-op commits, beforeMoveRef abort, subset extractTree, walkHistory).
 * 2. Twin-repo lockstep seeded fuzzing (configurable via DIFF_SEED / DIFF_STEPS).
 * 3. Single-repo random interleaving (mixed gix <-> gitcl + pack-refs / repack) vs shadow oracle.
 * 4. Hostile host `.gitconfig` matrix (autocrlf, gpgsign, commitEncoding, failing hooks).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  GitCommitFile,
  GitCommitInput,
  GitEngine,
  GitError,
  GitFileMode,
  GitRepo,
} from "@prismshadow/penguin-core/plugin";
import { loadNative } from "../src/binary.js";
import { gixGitEngine } from "../src/git-engine.js";
import { gitclGitEngine } from "@penguinharness/agent-state-gitcl";

const GIT = "git";

function runGitSync(gitdir: string, args: string[]): { status: number; stdout: string; stderr: string } {
  const r = spawnSync(GIT, ["--git-dir", gitdir, ...args], {
    windowsHide: true,
    encoding: "utf8",
  });
  return { status: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

async function initBare(gitdir: string): Promise<void> {
  const r = spawnSync(GIT, ["init", "--bare", "--initial-branch=main", gitdir], {
    windowsHide: true,
    encoding: "utf8",
  });
  if (r.status !== 0) throw new Error(`git init failed: ${r.stderr}`);
}

async function readExtractedTree(destDir: string, files: readonly string[]): Promise<Record<string, Buffer>> {
  const out: Record<string, Buffer> = {};
  for (const rel of files) {
    out[rel] = await fs.readFile(path.join(destDir, rel));
  }
  return out;
}

/** Deterministic Mulberry32 PRNG for reproducible differential fuzzing. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function expectGitErrorCode(promise: Promise<unknown>, code: string): Promise<void> {
  let caught: unknown;
  try {
    await promise;
  } catch (err) {
    caught = err;
  }
  expect(caught, `expected GitError(${code})`).toBeDefined();
  expect((caught as GitError).code, (caught as Error)?.message).toBe(code);
}

describe("GitEngine differential testing: gix <-> gitcl", () => {
  const native = loadNative();
  const gix: GitEngine = gixGitEngine(native, native.engineVersion());
  const gitVer =
    /^git version (\S+)/.exec(spawnSync(GIT, ["version"], { encoding: "utf8" }).stdout ?? "")?.[1] ?? "git";
  const gitcl: GitEngine = gitclGitEngine({ program: GIT }, gitVer);

  let root: string;
  let diskFilesDir: string;

  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "git-engine-diff-"));
    diskFilesDir = path.join(root, "disk-sources");
    await fs.mkdir(diskFilesDir, { recursive: true });
  });

  afterAll(async () => {
    await fs.rm(root, { recursive: true, force: true }).catch(() => undefined);
  });

  async function writeDiskSource(name: string, body: Buffer | string): Promise<string> {
    const abs = path.join(diskFilesDir, name);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, body);
    return abs;
  }

  describe("L1: deterministic parity & structured GitError codes", () => {
    it("direct-to-FS file streaming, bytes, patch, modes, negative timezones, and verbatim messages produce identical SHAs", async () => {
      const gixDir = path.join(root, "l1-gix.git");
      const gitclDir = path.join(root, "l1-gitcl.git");
      await Promise.all([initBare(gixDir), initBare(gitclDir)]);

      const rGix = await gix.open(gixDir);
      const rGitcl = await gitcl.open(gitclDir);
      try {
        expect(await rGix.resolveHead()).toEqual({ ref: "refs/heads/main", commit: null });
        expect(await rGitcl.resolveHead()).toEqual({ ref: "refs/heads/main", commit: null });

        const fAlpha = await writeDiskSource("alpha.txt", "line1\r\nline2\n");
        const fBin = await writeDiskSource("bin.dat", Buffer.from([0x00, 0xff, 0x0d, 0x0a, 0x7f]));
        const fScript = await writeDiskSource("run.sh", "#!/bin/sh\necho ok\n");
        const fEmpty = await writeDiskSource("empty.txt", Buffer.alloc(0));

        // Commit 1: first commit with direct-from-FS files + bytes + 100755 mode + negative half-hour timezone + # comment message
        const c1: GitCommitInput = {
          ref: "refs/heads/main",
          parent: null,
          prefix: "workbenches/demo",
          change: {
            kind: "replace",
            files: [
              { rel: "alpha.txt", source: { kind: "file", path: fAlpha } },
              { rel: "nested/bin.dat", source: { kind: "file", path: fBin } },
              { rel: "bin/run.sh", source: { kind: "file", path: fScript }, mode: "100755" },
              { rel: "empty.txt", source: { kind: "file", path: fEmpty } },
              { rel: "ui.css", source: { kind: "bytes", body: Buffer.from("body{}\n") } },
              { rel: "ui/index.html", source: { kind: "bytes", body: Buffer.from("<h1>v1</h1>\n") } },
              { rel: "ａ.txt", source: { kind: "bytes", body: Buffer.from("fullwidth") } },
              { rel: "\u{1F600}.txt", source: { kind: "bytes", body: Buffer.from("astral") } },
            ],
          },
          message: "initial commit\n\n# keep comment line verbatim\n  indented  \n",
          author: { name: "Ada Lovelace", email: "ada@example.com" },
          committer: { name: "Penguin Server", email: "server@example.com" },
          when: { seconds: 1_700_000_000, offset: -330 }, // -0530
        };

        const [sha1Gix, sha1Gitcl] = await Promise.all([rGix.commit(c1), rGitcl.commit(c1)]);
        expect(sha1Gix).toBe(sha1Gitcl);
        expect(sha1Gix).toMatch(/^[0-9a-f]{40}$/);

        // listTree parity without and with size
        expect(await rGix.listTree(sha1Gix, "workbenches/demo")).toEqual(
          await rGitcl.listTree(sha1Gitcl, "workbenches/demo"),
        );
        const listWithSizeGix = await rGix.listTree(sha1Gix, "workbenches/demo", { withSize: true });
        const listWithSizeGitcl = await rGitcl.listTree(sha1Gitcl, "workbenches/demo", { withSize: true });
        expect(listWithSizeGix).toEqual(listWithSizeGitcl);
        expect(listWithSizeGix!.find((e) => e.rel === "bin/run.sh")?.mode).toBe("100755");
        expect(listWithSizeGix!.find((e) => e.rel === "empty.txt")?.size).toBe(0);

        // Commit 2: patch mode (remove nested/bin.dat -> prunes empty nested/, update alpha.txt)
        const fAlpha2 = await writeDiskSource("alpha2.txt", "updated\r\n");
        const c2: GitCommitInput = {
          ref: "refs/heads/main",
          parent: sha1Gix,
          prefix: "workbenches/demo",
          change: {
            kind: "patch",
            upsert: [{ rel: "alpha.txt", source: { kind: "file", path: fAlpha2 } }],
            remove: ["nested/bin.dat"],
          },
          message: "patch commit\n",
          author: { name: "Grace Hopper", email: "grace@example.com" },
          committer: { name: "Penguin Server", email: "server@example.com" },
          when: { seconds: 1_700_000_120, offset: 0 },
        };
        const [sha2Gix, sha2Gitcl] = await Promise.all([rGix.commit(c2), rGitcl.commit(c2)]);
        expect(sha2Gix).toBe(sha2Gitcl);

        // Commit 3: no-op commit on existing parent must succeed identically on both
        const c3: GitCommitInput = {
          ref: "refs/heads/main",
          parent: sha2Gix,
          prefix: "workbenches/demo",
          change: { kind: "patch", upsert: [], remove: [] },
          message: "noop commit\n",
          author: { name: "Grace Hopper", email: "grace@example.com" },
          committer: { name: "Penguin Server", email: "server@example.com" },
          when: { seconds: 1_700_000_240, offset: 525 }, // +0845
        };
        const [sha3Gix, sha3Gitcl] = await Promise.all([rGix.commit(c3), rGitcl.commit(c3)]);
        expect(sha3Gix).toBe(sha3Gitcl);

        // walkHistory parity (should only list c2 and c1 because c3 didn't change workbenches/demo tree)
        const histGix = await rGix.walkHistory({
          fromCommit: sha3Gix,
          prefix: "workbenches/demo",
          limit: 50,
          maxWalk: 100,
        });
        const histGitcl = await rGitcl.walkHistory({
          fromCommit: sha3Gitcl,
          prefix: "workbenches/demo",
          limit: 50,
          maxWalk: 100,
        });
        expect(histGix).toEqual(histGitcl);
        expect(histGix.map((h) => h.commit)).toEqual([sha2Gix, sha1Gix]);

        // beforeMoveRef abort: must NOT move ref on either engine
        const abortErr = new Error("directory changed mid-flight");
        const cAbort: GitCommitInput = {
          ...c2,
          parent: sha3Gix,
          message: "aborted\n",
          beforeMoveRef: async () => {
            throw abortErr;
          },
        };
        await expect(rGix.commit(cAbort)).rejects.toThrow("directory changed mid-flight");
        await expect(rGitcl.commit(cAbort)).rejects.toThrow("directory changed mid-flight");
        expect((await rGix.resolveHead()).commit).toBe(sha3Gix);
        expect((await rGitcl.resolveHead()).commit).toBe(sha3Gitcl);

        // Subset extractTree parity (onlyPaths)
        const subGix = path.join(root, "sub-gix");
        const subGitcl = path.join(root, "sub-gitcl");
        const [exGix, exGitcl] = await Promise.all([
          rGix.extractTree({
            commitOid: sha1Gix,
            prefix: "workbenches/demo",
            destDir: subGix,
            onlyPaths: ["alpha.txt", "bin/run.sh", "nested/bin.dat"],
          }),
          rGitcl.extractTree({
            commitOid: sha1Gitcl,
            prefix: "workbenches/demo",
            destDir: subGitcl,
            onlyPaths: ["alpha.txt", "bin/run.sh", "nested/bin.dat"],
          }),
        ]);
        expect(exGix).toEqual(exGitcl);
        expect(await readExtractedTree(subGix, exGix.files)).toEqual(
          await readExtractedTree(subGitcl, exGitcl.files),
        );

        // Structured GitError.code parity
        await expectGitErrorCode(rGix.commit({ ...c1, parent: null }), "CAS_CONFLICT");
        await expectGitErrorCode(rGitcl.commit({ ...c1, parent: null }), "CAS_CONFLICT");
        await expectGitErrorCode(rGix.commit({ ...c2, parent: sha1Gix }), "CAS_CONFLICT");
        await expectGitErrorCode(rGitcl.commit({ ...c2, parent: sha1Gitcl }), "CAS_CONFLICT");
        await expectGitErrorCode(rGix.commit({ ...c2, parent: "1".repeat(40) }), "PARENT_NOT_FOUND");
        await expectGitErrorCode(rGitcl.commit({ ...c2, parent: "1".repeat(40) }), "PARENT_NOT_FOUND");
        await expectGitErrorCode(
          rGix.extractTree({ commitOid: sha1Gix, prefix: "workbenches/demo", destDir: subGix }),
          "DEST_NOT_EMPTY",
        );
        await expectGitErrorCode(
          rGitcl.extractTree({ commitOid: sha1Gitcl, prefix: "workbenches/demo", destDir: subGitcl }),
          "DEST_NOT_EMPTY",
        );
        await expectGitErrorCode(
          rGix.extractTree({
            commitOid: sha1Gix,
            prefix: "workbenches/demo",
            destDir: path.join(root, "bad-only-gix"),
            onlyPaths: ["../escape.txt"],
          }),
          "INVALID_PATH",
        );
        await expectGitErrorCode(
          rGitcl.extractTree({
            commitOid: sha1Gitcl,
            prefix: "workbenches/demo",
            destDir: path.join(root, "bad-only-gitcl"),
            onlyPaths: ["../escape.txt"],
          }),
          "INVALID_PATH",
        );

        expect(runGitSync(gixDir, ["fsck", "--strict", "--no-dangling"]).status).toBe(0);
        expect(runGitSync(gitclDir, ["fsck", "--strict", "--no-dangling"]).status).toBe(0);
      } finally {
        await Promise.all([rGix.close(), rGitcl.close()]);
      }
    });

    it("resolveHead throws INVALID_REF on detached/corrupt HEAD and empty ref identically on both", async () => {
      for (const [label, eng] of [
        ["gix", gix],
        ["gitcl", gitcl],
      ] as const) {
        const gd = path.join(root, `bad-head-${label}.git`);
        await initBare(gd);
        const repo = await eng.open(gd);
        try {
          await fs.writeFile(path.join(gd, "HEAD"), "0".repeat(40) + "\n");
          await expectGitErrorCode(repo.resolveHead(), "INVALID_REF");

          await fs.writeFile(path.join(gd, "HEAD"), "ref: refs/heads/main\n");
          await fs.writeFile(path.join(gd, "refs", "heads", "main"), "");
          await expectGitErrorCode(repo.resolveHead(), "INVALID_REF");
        } finally {
          await repo.close();
        }
      }
    });
  });

  describe("L2: twin-repo lockstep seeded fuzzing", () => {
    it("remains byte-identical across randomized commits, patches, removals, repacks, and extractions", async () => {
      const seed = Number(process.env.DIFF_SEED ?? 20261128);
      const steps = Number(process.env.DIFF_STEPS ?? 45);
      const rand = mulberry32(seed);

      const gixDir = path.join(root, `fuzz-gix-${seed}.git`);
      const gitclDir = path.join(root, `fuzz-gitcl-${seed}.git`);
      await Promise.all([initBare(gixDir), initBare(gitclDir)]);

      const rGix = await gix.open(gixDir);
      const rGitcl = await gitcl.open(gitclDir);

      const prefixes = ["workbenches/w1", "workbenches/w2", "workbenches/nested/w3"];
      const poolPaths = [
        "package.json",
        "index.ts",
        "ui.css",
        "ui/app.tsx",
        "ui/sub/deep.txt",
        "scripts/run.sh",
        "a-b.txt",
        "a/b.txt",
        "empty.bin",
        "ａ.txt",
        "\u{1F600}.txt",
      ];
      const offsets = [-480, -330, 0, 330, 480];

      let tip: string | null = null;
      let ts = 1_710_000_000;

      try {
        for (let step = 0; step < steps; step++) {
          ts += 1 + Math.floor(rand() * 30);
          const prefix = prefixes[Math.floor(rand() * prefixes.length)]!;
          const offset = offsets[Math.floor(rand() * offsets.length)]!;
          const op = rand();

          if (op < 0.12 && tip !== null) {
            // Pack refs & repack objects on both repos to test packed-refs + packfile deltas
            expect(runGitSync(gixDir, ["pack-refs", "--all"]).status).toBe(0);
            expect(runGitSync(gitclDir, ["pack-refs", "--all"]).status).toBe(0);
            expect(runGitSync(gixDir, ["repack", "-adq"]).status).toBe(0);
            expect(runGitSync(gitclDir, ["repack", "-adq"]).status).toBe(0);
            expect(await rGix.resolveHead()).toEqual(await rGitcl.resolveHead());
            continue;
          }

          if (op < 0.2 && tip !== null) {
            // Stale CAS check
            const badParent = "a".repeat(40);
            const staleInput: GitCommitInput = {
              ref: "refs/heads/main",
              parent: badParent,
              prefix,
              change: { kind: "replace", files: null },
              message: `stale ${step}\n`,
              author: { name: "Fuzz", email: "fuzz@example.com" },
              committer: { name: "Fuzz", email: "fuzz@example.com" },
              when: { seconds: ts, offset },
            };
            await expectGitErrorCode(rGix.commit(staleInput), "PARENT_NOT_FOUND");
            await expectGitErrorCode(rGitcl.commit(staleInput), "PARENT_NOT_FOUND");
            continue;
          }

          let change: GitCommitInput["change"];
          if (op < 0.35) {
            // Subtree removal
            change = { kind: "replace", files: null };
          } else if (op < 0.65 && tip !== null) {
            // Patch mode
            const upsertCount = Math.floor(rand() * 4);
            const removeCount = Math.floor(rand() * 3);
            const upsert: GitCommitFile[] = [];
            const chosen = new Set<string>();
            for (let i = 0; i < upsertCount; i++) {
              const rel = poolPaths[Math.floor(rand() * poolPaths.length)]!;
              if (chosen.has(rel)) continue;
              chosen.add(rel);
              const mode: GitFileMode = rel.endsWith(".sh") ? "100755" : "100644";
              const payload =
                rel === "empty.bin"
                  ? Buffer.alloc(0)
                  : Buffer.from(`step=${step}\r\nrel=${rel}\nrand=${rand()}\n`);
              if (rand() < 0.5) {
                const filePath = await writeDiskSource(`fuzz-${seed}-${step}-${i}.dat`, payload);
                upsert.push({ rel, source: { kind: "file", path: filePath }, mode });
              } else {
                upsert.push({ rel, source: { kind: "bytes", body: payload }, mode });
              }
            }
            const remove: string[] = [];
            for (let i = 0; i < removeCount; i++) {
              const rel = poolPaths[Math.floor(rand() * poolPaths.length)]!;
              if (!chosen.has(rel) && !remove.includes(rel)) remove.push(rel);
            }
            change = { kind: "patch", upsert, remove };
          } else {
            // Replace mode
            const count = 1 + Math.floor(rand() * 5);
            const files: GitCommitFile[] = [];
            const seen = new Set<string>();
            for (let i = 0; i < count; i++) {
              const rel = poolPaths[Math.floor(rand() * poolPaths.length)]!;
              if (seen.has(rel)) continue;
              seen.add(rel);
              const mode: GitFileMode = rel.endsWith(".sh") ? "100755" : "100644";
              const payload =
                rel === "empty.bin"
                  ? Buffer.alloc(0)
                  : Buffer.from([0x00, step & 0xff, 0x0d, 0x0a, ...Buffer.from(`s${step}:${rel}`)]);
              if (rand() < 0.6) {
                const filePath = await writeDiskSource(`rep-${seed}-${step}-${i}.dat`, payload);
                files.push({ rel, source: { kind: "file", path: filePath }, mode });
              } else {
                files.push({ rel, source: { kind: "bytes", body: payload }, mode });
              }
            }
            change = { kind: "replace", files };
          }

          const input: GitCommitInput = {
            ref: "refs/heads/main",
            parent: tip,
            prefix,
            change,
            message: `fuzz step ${step} (seed ${seed})\n# verbatim\n`,
            author: { name: "Fuzzer", email: "fuzz@example.com" },
            committer: { name: "Penguin", email: "penguin@example.com" },
            when: { seconds: ts, offset },
          };

          const [shaGix, shaGitcl] = await Promise.all([rGix.commit(input), rGitcl.commit(input)]);
          expect(shaGix, `SHA mismatch at seed=${seed} step=${step}`).toBe(shaGitcl);
          tip = shaGix;

          // Verify listTree & walkHistory parity
          const [ltGix, ltGitcl] = await Promise.all([
            rGix.listTree(tip, prefix, { withSize: step % 2 === 0 }),
            rGitcl.listTree(tip, prefix, { withSize: step % 2 === 0 }),
          ]);
          expect(ltGix, `listTree mismatch at seed=${seed} step=${step}`).toEqual(ltGitcl);

          const [whGix, whGitcl] = await Promise.all([
            rGix.walkHistory({ fromCommit: tip, prefix, limit: 10, maxWalk: 50 }),
            rGitcl.walkHistory({ fromCommit: tip, prefix, limit: 10, maxWalk: 50 }),
          ]);
          expect(whGix, `walkHistory mismatch at seed=${seed} step=${step}`).toEqual(whGitcl);

          // Periodically verify extractTree byte-for-byte parity
          if (step % 7 === 0 && ltGix !== null && ltGix.length > 0) {
            const exDirGix = path.join(root, `ex-gix-${seed}-${step}`);
            const exDirGitcl = path.join(root, `ex-gitcl-${seed}-${step}`);
            const onlyPaths = ltGix.length > 2 ? [ltGix[0]!.rel, ltGix[ltGix.length - 1]!.rel] : undefined;
            const [resGix, resGitcl] = await Promise.all([
              rGix.extractTree({ commitOid: tip, prefix, destDir: exDirGix, onlyPaths }),
              rGitcl.extractTree({ commitOid: tip, prefix, destDir: exDirGitcl, onlyPaths }),
            ]);
            expect(resGix).toEqual(resGitcl);
            expect(await readExtractedTree(exDirGix, resGix.files)).toEqual(
              await readExtractedTree(exDirGitcl, resGitcl.files),
            );
          }
        }

        expect(runGitSync(gixDir, ["fsck", "--strict", "--no-dangling"]).status).toBe(0);
        expect(runGitSync(gitclDir, ["fsck", "--strict", "--no-dangling"]).status).toBe(0);
      } finally {
        await Promise.all([rGix.close(), rGitcl.close()]);
      }
    });
  });

  describe("L3: single-repo random interleaving vs shadow oracle", () => {
    it("mixed gix <-> gitcl writes on one repo produce the exact same HEAD SHA as a single-engine oracle", async () => {
      const rand = mulberry32(991122);
      const mixedDir = path.join(root, "mixed.git");
      const oracleDir = path.join(root, "oracle.git");
      await Promise.all([initBare(mixedDir), initBare(oracleDir)]);

      const mGix = await gix.open(mixedDir);
      const mGitcl = await gitcl.open(mixedDir);
      const oracle = await gix.open(oracleDir);

      let tip: string | null = null;
      let ts = 1_720_000_000;
      try {
        for (let step = 0; step < 30; step++) {
          ts += 5;
          const useGix = rand() < 0.5;
          const writer: GitRepo = useGix ? mGix : mGitcl;
          const reader: GitRepo = useGix ? mGitcl : mGix;
          const prefix = step % 2 === 0 ? "workbenches/a" : "workbenches/b";

          const fPath = await writeDiskSource(`mix-${step}.txt`, `mixed step ${step}\r\n`);
          const input: GitCommitInput = {
            ref: "refs/heads/main",
            parent: tip,
            prefix,
            change:
              step % 6 === 5
                ? { kind: "replace", files: null }
                : {
                    kind: "replace",
                    files: [
                      { rel: "main.txt", source: { kind: "file", path: fPath } },
                      { rel: `f${step % 3}.txt`, source: { kind: "bytes", body: Buffer.from(`v${step}`) } },
                    ],
                  },
            message: `interleave ${step}\n`,
            author: { name: "Mix", email: "mix@example.com" },
            committer: { name: "Mix", email: "mix@example.com" },
            when: { seconds: ts, offset: 480 },
          };

          const [mixedSha, oracleSha] = await Promise.all([writer.commit(input), oracle.commit(input)]);
          expect(mixedSha).toBe(oracleSha);
          tip = mixedSha;

          if (step % 5 === 0) {
            expect(runGitSync(mixedDir, ["pack-refs", "--all"]).status).toBe(0);
            expect(runGitSync(mixedDir, ["repack", "-adq"]).status).toBe(0);
          }

          // Opposite engine immediately reads what the writer just committed
          expect((await reader.resolveHead()).commit).toBe(tip);
          expect(await reader.listTree(tip, prefix, { withSize: true })).toEqual(
            await oracle.listTree(tip, prefix, { withSize: true }),
          );
          expect(await reader.walkHistory({ fromCommit: tip, prefix, limit: 20, maxWalk: 50 })).toEqual(
            await oracle.walkHistory({ fromCommit: tip, prefix, limit: 20, maxWalk: 50 }),
          );
        }

        expect(runGitSync(mixedDir, ["fsck", "--strict"]).status).toBe(0);
      } finally {
        await Promise.all([mGix.close(), mGitcl.close(), oracle.close()]);
      }
    });
  });

  describe("L4: hostile host .gitconfig matrix", () => {
    it("gitcl stays byte-identical to gix despite poisoned HOME/.gitconfig and failing hooks", async () => {
      const poisonedHome = path.join(root, "poisoned-home");
      const hooksDir = path.join(poisonedHome, "hooks");
      await fs.mkdir(hooksDir, { recursive: true });
      const badHook = path.join(hooksDir, "pre-commit");
      await fs.writeFile(badHook, "#!/bin/sh\necho SHOULD_NOT_RUN >&2\nexit 1\n", { mode: 0o755 });
      const poisonedConfig = path.join(poisonedHome, ".gitconfig");
      await fs.writeFile(
        poisonedConfig,
        [
          "[core]",
          "\tautocrlf = true",
          "\tsafecrlf = true",
          `\thooksPath = ${hooksDir}`,
          "[commit]",
          "\tgpgsign = true",
          "[i18n]",
          "\tcommitEncoding = ISO-8859-1",
          "[init]",
          "\tdefaultObjectFormat = sha256",
          "",
        ].join("\n"),
      );

      const gixDir = path.join(root, "hostile-gix.git");
      const gitclDir = path.join(root, "hostile-gitcl.git");
      await Promise.all([initBare(gixDir), initBare(gitclDir)]);

      const prevHome = process.env.HOME;
      const prevGlobal = process.env.GIT_CONFIG_GLOBAL;
      process.env.HOME = poisonedHome;
      process.env.GIT_CONFIG_GLOBAL = poisonedConfig;
      try {
        const rGix = await gix.open(gixDir);
        const rGitcl = await gitcl.open(gitclDir);
        try {
          const crlfFile = await writeDiskSource("crlf.txt", "hello\r\nworld\r\n");
          const input: GitCommitInput = {
            ref: "refs/heads/main",
            parent: null,
            prefix: "workbenches/hostile",
            change: {
              kind: "replace",
              files: [{ rel: "crlf.txt", source: { kind: "file", path: crlfFile } }],
            },
            message: "hostile env test\n# comment\n",
            author: { name: "Test", email: "test@example.com" },
            committer: { name: "Test", email: "test@example.com" },
            when: { seconds: 1_730_000_000, offset: 480 },
          };
          const [shaGix, shaGitcl] = await Promise.all([rGix.commit(input), rGitcl.commit(input)]);
          expect(shaGix).toBe(shaGitcl);
        } finally {
          await Promise.all([rGix.close(), rGitcl.close()]);
        }
      } finally {
        if (prevHome === undefined) delete process.env.HOME;
        else process.env.HOME = prevHome;
        if (prevGlobal === undefined) delete process.env.GIT_CONFIG_GLOBAL;
        else process.env.GIT_CONFIG_GLOBAL = prevGlobal;
      }
    });

    it("small and boundary Unix timestamps (@0, @1, @2, @526, @99999999) produce identical SHAs across gix and gitcl", async () => {
      const gixDir = path.join(root, "ts-gix.git");
      const gitclDir = path.join(root, "ts-gitcl.git");
      await Promise.all([initBare(gixDir), initBare(gitclDir)]);

      const rGix = await gix.open(gixDir);
      const rGitcl = await gitcl.open(gitclDir);
      try {
        const file = await writeDiskSource("ts.txt", "timestamp regression\n");
        const cases = [
          { seconds: 0, offset: 0 },
          { seconds: 1, offset: 480 },
          { seconds: 2, offset: -330 },
          { seconds: 526, offset: 525 },
          { seconds: 99_999_999, offset: -720 },
          { seconds: 100_000_000, offset: 840 },
        ];
        let parent: string | null = null;
        for (const when of cases) {
          const input: GitCommitInput = {
            ref: "refs/heads/main",
            parent,
            prefix: "workbenches/ts",
            change: {
              kind: "replace",
              files: [{ rel: "ts.txt", source: { kind: "file", path: file } }],
            },
            message: `ts ${when.seconds} ${when.offset}\n`,
            author: { name: "Test", email: "test@example.com" },
            committer: { name: "Test", email: "test@example.com" },
            when,
          };
          const [shaGix, shaGitcl] = await Promise.all([rGix.commit(input), rGitcl.commit(input)]);
          expect(shaGix).toBe(shaGitcl);
          parent = shaGix;
        }
      } finally {
        await Promise.all([rGix.close(), rGitcl.close()]);
      }
    });
  });
});
