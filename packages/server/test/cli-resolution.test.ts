/**
 * Resolution: the record decides — an install image names its program layout's loader, a
 * local push leaves the caller's own loader as the answer — and the resolver reports what
 * the record said, falling back to what the caller offers when it says nothing.
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

/** A caller entry on disk, so the own-entry answer names something real. */
async function makeCaller(): Promise<string> {
  const dir = await tmp("penguin-resolution-caller-");
  const entry = path.join(dir, "dist", "penguin.js");
  await fs.mkdir(path.dirname(entry), { recursive: true });
  await fs.writeFile(entry, "export const cli = async () => 0;\n");
  return entry;
}

/** A data root whose record's CLI half is spelled by `record`. */
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

/** A record an install image lays down: the program layout's loader, relative. */
const IMAGE_RECORD = { cli: { bundle: "store/cli/abc123.mjs", entry: "lib/dist/penguin-hmr.js" } };
/** A record a local push leaves: the bundle only — the answer is the caller's own loader. */
const LOCAL_PUSH_RECORD = { cli: { bundle: "store/cli/abc123.mjs" } };

describe("the names an answer is made of", () => {
  it("is the two faults and the one reason, verbatim", () => {
    expect([...CLI_FAULTS]).toEqual(["record-unsupported", "cli-unloadable"]);
    expect([...CLI_REASONS]).toEqual(["recorded-entry"]);
  });
});

describe("the record decides", () => {
  it("answers a recorded entry with that entry and the bundle it names", async () => {
    const caller = await makeCaller();
    const { root } = await makeRoot({
      record: {
        cli: { bundle: "store/cli/abc123.mjs", entry: "/install/lib/dist/penguin-hmr.js" },
      },
    });
    await expect(resolveCli({ callerEntry: caller, root })).resolves.toMatchObject({
      kind: "entry",
      entry: "/install/lib/dist/penguin-hmr.js",
      reason: "recorded-entry",
      bundle: path.join(root, "hmr", "store", "cli", "abc123.mjs"),
    });
  });

  it("resolves a program-relative entry against the named program directory", async () => {
    const caller = await makeCaller();
    const { root } = await makeRoot({ record: IMAGE_RECORD });
    await expect(
      resolveCli({ callerEntry: caller, root, programDir: "/install" }),
    ).resolves.toMatchObject({
      kind: "entry",
      entry: "/install/lib/dist/penguin-hmr.js",
      reason: "recorded-entry",
    });
  });

  it("faults a program-relative entry on a process that stands on no program directory", async () => {
    const caller = await makeCaller();
    const { root } = await makeRoot({ record: IMAGE_RECORD });
    await expect(
      resolveCli({ callerEntry: caller, root, programDir: null }),
    ).resolves.toMatchObject({ kind: "fault", fault: "record-unsupported" });
  });

  it("answers a bundle with no recorded entry by the loader the caller offers", async () => {
    const caller = await makeCaller();
    const { root } = await makeRoot({ record: LOCAL_PUSH_RECORD });
    await expect(
      resolveCli({ callerEntry: caller, root, ownLoader: "/install/lib/dist/penguin-hmr.js" }),
    ).resolves.toMatchObject({
      kind: "entry",
      entry: "/install/lib/dist/penguin-hmr.js",
      reason: "recorded-entry",
      bundle: path.join(root, "hmr", "store", "cli", "abc123.mjs"),
    });
  });

  it("faults a bundle with no recorded entry when the caller offers no loader", async () => {
    const caller = await makeCaller();
    const { root } = await makeRoot({ record: LOCAL_PUSH_RECORD });
    await expect(resolveCli({ callerEntry: caller, root })).resolves.toMatchObject({
      kind: "fault",
      fault: "record-unsupported",
    });
  });

  it("answers nothing pushed with the caller's own entry", async () => {
    const caller = await makeCaller();
    const { root } = await makeRoot();
    await expect(resolveCli({ callerEntry: caller, root })).resolves.toMatchObject({
      kind: "entry",
      entry: caller,
      reason: "recorded-entry",
      bundle: null,
    });
  });

  it("answers a record with no committed version the same way", async () => {
    const caller = await makeCaller();
    const { root } = await makeRoot({ record: { platform: { bundle: "store/platform/x.mjs" } } });
    await expect(resolveCli({ callerEntry: caller, root })).resolves.toMatchObject({
      kind: "entry",
      reason: "recorded-entry",
      bundle: null,
    });
  });

  it("faults a record that will not parse", async () => {
    const caller = await makeCaller();
    const { root } = await makeRoot({ raw: "{ not json" });
    await expect(resolveCli({ callerEntry: caller, root })).resolves.toMatchObject({
      kind: "fault",
      fault: "record-unsupported",
    });
  });
});

describe("the command shim on the answer", () => {
  it("runs the recorded entry, and the server's own entry with the name on a fault", async () => {
    const own = {
      entry: "/install/penguin.js",
      execArgs: ["--import", "tsx"],
      unavailable: null,
    };

    const caller = await makeCaller();
    const { root } = await makeRoot({
      record: {
        cli: { bundle: "store/cli/abc123.mjs", entry: "/install/lib/dist/penguin-hmr.js" },
      },
    });
    await expect(
      resolveCli({ callerEntry: caller, root }).then((resolved) =>
        shimFromResolution(own, resolved),
      ),
    ).resolves.toEqual({
      entry: "/install/lib/dist/penguin-hmr.js",
      execArgs: [],
      unavailable: null,
      answerName: "recorded-entry",
    });

    const legacy = await makeRoot({ record: LOCAL_PUSH_RECORD });
    await expect(
      resolveCli({ callerEntry: caller, root: legacy.root }).then((resolved) =>
        shimFromResolution(own, resolved),
      ),
    ).resolves.toEqual({
      entry: own.entry,
      execArgs: own.execArgs,
      unavailable: null,
      answerName: "record-unsupported",
    });

    expect(shimFromResolution(own, null)).toMatchObject({ answerName: "no-entry" });
  });
});
