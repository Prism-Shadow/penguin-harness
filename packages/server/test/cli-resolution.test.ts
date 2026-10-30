/**
 * Resolution: the record decides — the writer named the entry — and the resolver reports
 * what it said. The cases are the record's states, and the names it answers with.
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

/** A data root whose record's CLI half carries an entry, a bundle, both, or neither. */
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

/** A record a push of this version leaves: the entry and the bundle, both absolute-ish. */
const RECORD_WITH_ENTRY = (entry: string) => ({
  cli: { bundle: "store/cli/abc123.mjs", entry },
});
/** A record a version before recorded entries left: a bundle only. */
const LEGACY_RECORD = { cli: { bundle: "store/cli/abc123.mjs" } };

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
      record: RECORD_WITH_ENTRY("/install/lib/dist/penguin-hmr.js"),
    });
    await expect(resolveCli({ callerEntry: caller, root })).resolves.toMatchObject({
      kind: "entry",
      entry: "/install/lib/dist/penguin-hmr.js",
      reason: "recorded-entry",
      bundle: path.join(root, "hmr", "store", "cli", "abc123.mjs"),
    });
  });

  it("resolves a program-relative entry against this process's program directory", async () => {
    const caller = await makeCaller();
    const { root } = await makeRoot({ record: RECORD_WITH_ENTRY("lib/dist/penguin-hmr.js") });
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
    const { root } = await makeRoot({ record: RECORD_WITH_ENTRY("lib/dist/penguin-hmr.js") });
    await expect(
      resolveCli({ callerEntry: caller, root, programDir: null }),
    ).resolves.toMatchObject({ kind: "fault", fault: "record-unsupported" });
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

describe("the transition from records without recorded entries", () => {
  it("faults a pre-entry record, naming the remedy", async () => {
    const caller = await makeCaller();
    const { root } = await makeRoot({ record: LEGACY_RECORD });
    const resolved = await resolveCli({ callerEntry: caller, root });
    expect(resolved).toMatchObject({ kind: "fault", fault: "record-unsupported" });
    if (resolved.kind === "fault") {
      expect(resolved.detail).toMatch(/push or install this version once/);
    }
  });

  it("and one push of this version rewrites the record so it answers", async () => {
    // The same root, after its next push: the host commits cli.entry (see hmr/host.ts's
    // persistVersion), and the record that faulted now answers.
    const caller = await makeCaller();
    const { root } = await makeRoot({ record: LEGACY_RECORD });
    await expect(resolveCli({ callerEntry: caller, root })).resolves.toMatchObject({
      kind: "fault",
    });
    await fs.writeFile(
      path.join(root, "hmr", "harness.json"),
      JSON.stringify(RECORD_WITH_ENTRY("/install/lib/dist/penguin-hmr.js")),
    );
    await expect(resolveCli({ callerEntry: caller, root })).resolves.toMatchObject({
      kind: "entry",
      entry: "/install/lib/dist/penguin-hmr.js",
      reason: "recorded-entry",
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
      record: RECORD_WITH_ENTRY("/install/lib/dist/penguin-hmr.js"),
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

    const legacy = await makeRoot({ record: LEGACY_RECORD });
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
