/**
 * The CI guard on plugin versions (scripts/check-plugin-versions.mjs), run as CI runs it: in a
 * git checkout, against the pull request's base commit. A plugin's version is its npm version;
 * the dated versions live on the parts an install writes — each skill, the hook package.
 *
 * - A skill whose files changed without a new version fails, naming the skill; raising its
 *   version passes.
 * - A changed hook script, or a changed hook command in package.json's `penguin.hooks`, fails
 *   until `penguin.hooks.version` is raised.
 * - The rest of package.json, README.md and icon.svg reach no installed copy and need nothing.
 * - Hook commands moved unchanged from a base's plugin.json into package.json need no bump; moved
 *   and changed at once, they need one, measured against the version the base's plugin.json had.
 * - Only plugin directories count: the library's own README is no plugin, and a plugin new since
 *   the base reads as new, with nothing printed but the summary.
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const GUARD = path.resolve(import.meta.dirname, "../../../scripts/check-plugin-versions.mjs");

const skillMd = (version: string | null, body = "Do the thing.") =>
  `---\nname: one\ndescription: One skill.\n${version === null ? "" : `version: ${version}\n`}---\n\n${body}\n`;

const HOOKS = { version: "2026.10.04.1", stop: [{ command: "stop.mjs", timeout: 60 }] };

/** The demo plugin's package.json, its `penguin` block carrying `hooks`. */
const packageJson = (hooks: unknown = HOOKS, extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    name: "@penguinharness/demo",
    version: "0.2.13",
    description: "Demo.",
    ...extra,
    penguin: { short_description: "Demo.", hooks },
  });

/** The repo's layout: dated versions on the skill and on the hook package. */
const PER_PART: Record<string, string> = {
  "plugins/demo/package.json": packageJson(),
  "plugins/demo/README.md": "# Demo\n",
  "plugins/demo/icon.svg": "<svg/>\n",
  "plugins/demo/skills/one/SKILL.md": skillMd("2026.10.04.1"),
  "plugins/demo/skills/one/reference/notes.md": "Notes.\n",
  "plugins/demo/hooks/stop.mjs": "export {};\n",
};

let repo: string | null = null;
afterEach(async () => {
  if (repo !== null) await fs.rm(repo, { recursive: true, force: true });
  repo = null;
});

const git = (...args: string[]) =>
  execFileSync(
    "git",
    [
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@example.invalid",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    { cwd: repo!, encoding: "utf8" },
  ).trim();

async function writeAll(files: Record<string, string | null>): Promise<void> {
  for (const [rel, text] of Object.entries(files)) {
    const file = path.join(repo!, rel);
    if (text === null) {
      await fs.rm(file, { force: true });
      continue;
    }
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, text);
  }
}

/** A checkout whose base commit holds `files`; answers the base sha. */
async function checkout(files: Record<string, string>): Promise<string> {
  repo = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-version-guard-"));
  git("init", "-q");
  await writeAll(files);
  git("add", "-A");
  git("commit", "-qm", "base");
  return git("rev-parse", "HEAD");
}

/** Commits `files` on top (null removes one) and runs the guard against `base`. */
async function guard(base: string, files: Record<string, string | null>) {
  await writeAll(files);
  git("add", "-A");
  git("commit", "-qm", "change", "--allow-empty");
  const run = spawnSync(process.execPath, [GUARD, base], { cwd: repo!, encoding: "utf8" });
  return { ok: run.status === 0, out: `${run.stdout}${run.stderr}` };
}

describe("the plugin version guard", () => {
  it("fails a skill whose files changed under the same version, naming it, and passes once it is raised", async () => {
    const base = await checkout(PER_PART);
    const stale = await guard(base, {
      "plugins/demo/skills/one/reference/notes.md": "New notes.\n",
    });
    expect(stale.ok).toBe(false);
    expect(stale.out).toContain(
      "plugins/demo/skills/one changed but its version is still 2026.10.04.1",
    );

    const raised = await guard(base, {
      "plugins/demo/skills/one/SKILL.md": skillMd("2026.10.09.1"),
    });
    expect(raised.ok).toBe(true);
  });

  it("fails a changed hook script or hook command until penguin.hooks.version is raised", async () => {
    const base = await checkout(PER_PART);
    expect((await guard(base, { "plugins/demo/hooks/stop.mjs": "export const x = 1;\n" })).ok).toBe(
      false,
    );
    await guard(base, { "plugins/demo/hooks/stop.mjs": PER_PART["plugins/demo/hooks/stop.mjs"]! });
    const longer = { ...HOOKS, stop: [{ command: "stop.mjs", timeout: 90 }] };
    const command = await guard(base, { "plugins/demo/package.json": packageJson(longer) });
    expect(command.ok).toBe(false);
    expect(command.out).toContain("plugins/demo/hooks changed but penguin.hooks.version is still");

    const raised = await guard(base, {
      "plugins/demo/package.json": packageJson({ ...longer, version: "2026.10.09.2" }),
    });
    expect(raised.ok).toBe(true);
  });

  it("asks nothing of the rest of package.json, of README.md or of icon.svg", async () => {
    const base = await checkout(PER_PART);
    const run = await guard(base, {
      "plugins/demo/package.json": packageJson(
        { stop: [{ timeout: 60, command: "stop.mjs" }], version: "2026.10.04.1" },
        { version: "0.2.14", description: "Demo, described better." },
      ),
      "plugins/demo/README.md": "# Demo, described better\n",
      "plugins/demo/icon.svg": "<svg viewBox='0 0 24 24'/>\n",
    });
    expect(run).toMatchObject({ ok: true });
  });

  it("lets hook commands moved unchanged from the base's plugin.json through, and holds a moved command that changed", async () => {
    // The base before the move: the hook declaration in plugin.json, no penguin block.
    const base = await checkout({
      ...PER_PART,
      "plugins/demo/package.json": JSON.stringify({
        name: "@penguinharness/demo",
        version: "0.2.13",
      }),
      "plugins/demo/plugin.json": JSON.stringify({ description: "Demo.", hooks: HOOKS }),
    });
    const moved = await guard(base, {
      "plugins/demo/plugin.json": null,
      "plugins/demo/package.json": packageJson(),
    });
    expect(moved.ok).toBe(true);

    const changed = await guard(base, {
      "plugins/demo/package.json": packageJson({ ...HOOKS, stop: [{ command: "stop.mjs" }] }),
    });
    expect(changed.ok).toBe(false);
    expect(changed.out).toContain("penguin.hooks.version is still 2026.10.04.1");
  });

  it("counts plugin directories only, and reads a plugin new since the base without noise", async () => {
    const base = await checkout(PER_PART);
    const run = await guard(base, {
      "plugins/README.md": "# The plugin library\n",
      "plugins/fresh/package.json": JSON.stringify({
        name: "@penguinharness/fresh",
        version: "0.2.13",
        penguin: { category: "office-productivity" },
      }),
      "plugins/fresh/skills/one/SKILL.md": skillMd("2026.10.09.1"),
    });
    expect(run.ok).toBe(true);
    // One line, the summary: a file missing at the base is no error to print.
    const lines = run.out.split("\n").filter((line) => line.trim() !== "");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("fresh/one");
    expect(lines[0]).not.toContain("README.md");
  });
});
