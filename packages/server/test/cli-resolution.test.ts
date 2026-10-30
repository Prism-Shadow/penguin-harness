/**
 * Resolution: the caller's own entry is what runs; the record decides only whether a pushed
 * bundle rides with it. The cases are the record's states.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CLI_FAULTS,
  CLI_REASONS,
  resolveCli,
  shimFromResolution,
  type CliResolution,
} from "../src/services/cli-shim.js";

const made: string[] = [];

async function tmp(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  made.push(dir);
  return dir;
}

afterEach(async () => {
  while (made.length > 0) {
    const dir = made.pop();
    if (dir !== undefined) await fs.rm(dir, { recursive: true, force: true });
  }
});

/** A caller entry on disk, so the answer names something real. */
async function makeCaller(): Promise<string> {
  const dir = await tmp("penguin-resolution-caller-");
  const entry = path.join(dir, "dist", "penguin.js");
  await fs.mkdir(path.dirname(entry), { recursive: true });
  await fs.writeFile(entry, "export const cli = async () => 0;\n");
  return entry;
}

/** A data root whose record is spelled by `record`, with its bundle present or not. */
async function makeRoot(
  options: { record?: unknown; raw?: string; bundle?: boolean } = {},
): Promise<{ root: string; bundle: string }> {
  const root = await tmp("penguin-resolution-root-");
  const bundle = path.join(root, "hmr", "store", "cli", "abc123.mjs");
  if (options.bundle !== false) {
    await fs.mkdir(path.dirname(bundle), { recursive: true });
    await fs.writeFile(bundle, "export const cli = async () => 0;\n");
  }
  if (options.raw !== undefined) {
    await fs.mkdir(path.join(root, "hmr"), { recursive: true });
    await fs.writeFile(path.join(root, "hmr", "harness.json"), options.raw);
  } else if (options.record !== undefined) {
    await fs.mkdir(path.join(root, "hmr"), { recursive: true });
    await fs.writeFile(path.join(root, "hmr", "harness.json"), JSON.stringify(options.record));
  }
  return { root, bundle };
}

describe("the names an answer is made of", () => {
  it("is the one fault and the one reason, verbatim", () => {
    expect([...CLI_FAULTS]).toEqual(["record-unsupported"]);
    expect([...CLI_REASONS]).toEqual(["own-entry"]);
  });
});

describe("the caller's own entry runs; the record decides what rides with it", () => {
  it("answers a pushed bundle with the caller's entry and the bundle", async () => {
    const caller = await makeCaller();
    const { root } = await makeRoot({ record: { cli: { bundle: "store/cli/abc123.mjs" } } });
    await expect(resolveCli({ callerEntry: caller, root })).resolves.toEqual({
      kind: "entry",
      entry: caller,
      reason: "own-entry",
      bundle: path.join(root, "hmr", "store", "cli", "abc123.mjs"),
    });
  });

  it("answers nothing pushed with the caller's entry and no bundle", async () => {
    const caller = await makeCaller();
    const { root } = await makeRoot();
    await expect(resolveCli({ callerEntry: caller, root })).resolves.toEqual({
      kind: "entry",
      entry: caller,
      reason: "own-entry",
      bundle: null,
    });
  });

  it("answers a record with no CLI half the same way — no committed version rides", async () => {
    const caller = await makeCaller();
    const { root } = await makeRoot({ record: { platform: { bundle: "store/platform/x.mjs" } } });
    await expect(resolveCli({ callerEntry: caller, root })).resolves.toMatchObject({
      kind: "entry",
      entry: caller,
      bundle: null,
    });
  });

  it("faults a record that will not parse, carrying what went wrong", async () => {
    const caller = await makeCaller();
    const { root } = await makeRoot({ raw: "{ not json" });
    const resolved = await resolveCli({ callerEntry: caller, root });
    expect(resolved).toMatchObject({ kind: "fault", fault: "record-unsupported" });
    if (resolved.kind === "fault") {
      expect(resolved.detail).toMatch(/harness\.json is not readable JSON/);
    }
  });
});

describe("the command shim on the answer", () => {
  it("keeps its own entry and options whatever the record said", async () => {
    const own = {
      entry: "/install/penguin.js",
      execArgs: ["--import", "tsx"],
      unavailable: null,
    };

    const caller = await makeCaller();
    const pushed = await makeRoot({ record: { cli: { bundle: "store/cli/abc123.mjs" } } });
    await expect(
      resolveCli({ callerEntry: caller, root: pushed.root }).then((resolved) =>
        shimFromResolution(own, resolved),
      ),
    ).resolves.toEqual({
      entry: own.entry,
      execArgs: own.execArgs,
      unavailable: null,
      answerName: "own-entry",
    });

    const bare = await makeRoot();
    await expect(
      resolveCli({ callerEntry: caller, root: bare.root }).then((resolved) =>
        shimFromResolution(own, resolved),
      ),
    ).resolves.toEqual({
      entry: own.entry,
      execArgs: own.execArgs,
      unavailable: null,
      answerName: "own-entry",
    });

    const broken = await makeRoot({ raw: "{ not json" });
    await expect(
      resolveCli({ callerEntry: caller, root: broken.root }).then((resolved) =>
        shimFromResolution(own, resolved),
      ),
    ).resolves.toEqual({
      entry: own.entry,
      execArgs: own.execArgs,
      unavailable: own.unavailable,
      answerName: "record-unsupported",
    });

    expect(shimFromResolution(own, null)).toMatchObject({ answerName: "no-entry" });
  });
});
