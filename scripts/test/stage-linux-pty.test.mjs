/**
 * Staging the portable Linux node-pty bindings (scripts/stage-linux-pty.mjs):
 * - Given a Linux install whose build/Release binding was compiled where it was installed (and
 *   is hardlinked to a package store), staging adds both portable bindings under prebuilds/ and
 *   puts the x64 one in build/Release, leaving the store's file as it was.
 * - Given an install made on macOS (no build/, darwin prebuilds only), staging adds the Linux
 *   prebuilds beside the darwin ones and touches nothing else.
 * - Given a binding built for another architecture than its directory names, or a Linux
 *   build/Release binding no portable one replaces, staging refuses and writes nothing.
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { it } from "node:test";
import { stageLinuxPty } from "../stage-linux-pty.mjs";
import { elfObject, MACH_O } from "./elf-fixture.mjs";

const X64 = elfObject({ machine: "x64", needs: { "libc.so.6": { "GLIBC_2.17": ["a"] } } });
const ARM64 = elfObject({ machine: "arm64", needs: { "libc.so.6": { "GLIBC_2.17": ["a"] } } });
const RUNNER_X64 = elfObject({ machine: "x64", needs: { "libc.so.6": { "GLIBC_2.42": ["b"] } } });

async function scratch(fn) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "stage-linux-pty-"));
  try {
    return await fn(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function write(file, bytes) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, bytes);
}

async function bindings(root, files = { "linux-x64": X64, "linux-arm64": ARM64 }) {
  const dir = path.join(root, "linux-pty");
  for (const [name, bytes] of Object.entries(files)) {
    await write(path.join(dir, name, "pty.node"), bytes);
  }
  return dir;
}

it("replaces a binding compiled at install and adds both Linux prebuilds, leaving the store alone", () =>
  scratch(async (root) => {
    const pty = path.join(root, "node-pty");
    const stored = path.join(root, "store", "pty.node");
    await write(path.join(pty, "package.json"), "{}");
    await write(stored, RUNNER_X64);
    await fs.mkdir(path.join(pty, "build", "Release"), { recursive: true });
    await fs.link(stored, path.join(pty, "build", "Release", "pty.node"));

    const [result] = stageLinuxPty(await bindings(root), [pty]);

    assert.deepEqual(result.staged, [
      "prebuilds/linux-arm64/pty.node",
      "prebuilds/linux-x64/pty.node",
      "build/Release/pty.node",
    ]);
    assert.deepEqual(await fs.readFile(path.join(pty, "build", "Release", "pty.node")), X64);
    assert.deepEqual(await fs.readFile(path.join(pty, "prebuilds", "linux-x64", "pty.node")), X64);
    assert.deepEqual(
      await fs.readFile(path.join(pty, "prebuilds", "linux-arm64", "pty.node")),
      ARM64,
    );
    assert.deepEqual(await fs.readFile(stored), RUNNER_X64);
  }));

it("adds the Linux prebuilds to an install made on macOS and leaves its own alone", () =>
  scratch(async (root) => {
    const pty = path.join(root, "node-pty");
    await write(path.join(pty, "package.json"), "{}");
    await write(path.join(pty, "prebuilds", "darwin-arm64", "pty.node"), MACH_O);

    const [result] = stageLinuxPty(await bindings(root), [pty]);

    assert.deepEqual(result.staged, [
      "prebuilds/linux-arm64/pty.node",
      "prebuilds/linux-x64/pty.node",
    ]);
    assert.deepEqual(
      await fs.readFile(path.join(pty, "prebuilds", "darwin-arm64", "pty.node")),
      MACH_O,
    );
    await assert.rejects(fs.access(path.join(pty, "build")));
  }));

it("refuses a binding for the wrong architecture, or a Linux binding nothing replaces, writing nothing", () =>
  scratch(async (root) => {
    const pty = path.join(root, "node-pty");
    await write(path.join(pty, "package.json"), "{}");
    await fs.mkdir(path.join(root, "empty"));
    assert.throws(
      () => stageLinuxPty(path.join(root, "empty"), [pty]),
      /no linux-<arch>\/pty\.node under/,
    );
    const wrong = await bindings(root, { "linux-arm64": X64 });
    assert.throws(() => stageLinuxPty(wrong, [pty]), /is built for x64, not arm64/);

    const arm = path.join(root, "arm-node-pty");
    await write(path.join(arm, "package.json"), "{}");
    await write(path.join(arm, "build", "Release", "pty.node"), ARM64);
    const onlyX64 = path.join(root, "only-x64");
    await write(path.join(onlyX64, "linux-x64", "pty.node"), X64);
    assert.throws(
      () => stageLinuxPty(onlyX64, [pty, arm]),
      /no portable linux-arm64 binding was given/,
    );
    await assert.rejects(fs.access(path.join(pty, "prebuilds")));
    assert.deepEqual(await fs.readFile(path.join(arm, "build", "Release", "pty.node")), ARM64);
  }));
