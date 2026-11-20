/**
 * Where a program started from a checkout finds the builtin plugins the checkout staged.
 *
 * - Given an entry anywhere inside a workspace checkout (the CLI's source, the dev-linked CLI,
 *   the server's dist), the prefix is the checkout's one staged `packages/server/plugins/`.
 * - Given an entry under node_modules (a test runner's own), there is none: a run never picks up
 *   what a developer happened to stage.
 * - Given an entry with no workspace above it (an installation), there is none.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { workspacePrefixManifest } from "../src/plugin/workspace-prefix.js";

const root = mkdtempSync(path.join(tmpdir(), "penguin-workspace-prefix-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const checkout = path.join(root, "checkout");
mkdirSync(checkout, { recursive: true });
writeFileSync(path.join(checkout, "pnpm-workspace.yaml"), "packages: []\n");
const staged = path.join(checkout, "packages", "server", "plugins", "package.json");

describe("the workspace's staged prefix", () => {
  it.each([
    ["the CLI's source", "packages/cli/src/penguin.ts"],
    ["the dev-linked CLI", "scripts/dev-cli-link/penguin.mjs"],
    ["the server's dist", "packages/server/dist/index.js"],
  ])("is the checkout's one prefix for %s", (_, entry) => {
    expect(workspacePrefixManifest(path.join(checkout, entry))).toBe(staged);
  });

  it("is none for an entry under node_modules", () => {
    const entry = path.join(checkout, "node_modules", "vitest", "vitest.mjs");
    expect(workspacePrefixManifest(entry)).toBeNull();
  });

  it("is none outside a workspace", () => {
    expect(
      workspacePrefixManifest(path.join(root, "install", "lib", "dist", "penguin.js")),
    ).toBeNull();
  });
});
