/**
 * `penguin plugin check` — the review, end to end over a fixture data root, plus the skill
 * scanner's pure half.
 *
 * The fixture root carries the three problem classes at once: two plugins contributing the
 * same key `greet` (the ambiguous section), one plugin whose registrations the ownership
 * rules refuse — a reserved root (`update.fast`), the server package's closed `web`
 * subtree, the same key twice, and an entry with no summary (the invalid section) — and
 * skill texts, one calling the ambiguous command bare and one already fixed through
 * `penguin exec` (the skills section: the hit lists the bare caller alone).
 *
 * A root with no problems answers "No problems found." and exits 0; anything found exits
 * 1, so a script can gate on the report.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CliCommandEntry } from "@prismshadow/penguin-core/plugin";
import { cli } from "../src/index.js";
import { scanSkillText } from "../src/commands/plugin.js";

/** Collects what `body` writes to one stream, alongside whatever it returns. */
async function capture<T>(
  stream: NodeJS.WriteStream,
  body: () => Promise<T>,
): Promise<{ out: string; result: T }> {
  const written: string[] = [];
  const original = stream.write.bind(stream);
  stream.write = ((chunk: string | Uint8Array) => {
    written.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  }) as typeof stream.write;
  try {
    const result = await body();
    return { out: written.join(""), result };
  } finally {
    stream.write = original;
  }
}

describe("scanSkillText (one skill file's lines against the ambiguous keys)", () => {
  const ambiguous = ["greet", "greet.world"];

  it("reports a line that calls an ambiguous command bare, with its number", () => {
    const text = ["# Skill", "", "Run `penguin greet world` to greet."].join("\n");
    expect(scanSkillText(text, "skills/x/SKILL.md", ambiguous)).toEqual([
      { file: "skills/x/SKILL.md", line: 3, text: "Run `penguin greet world` to greet." },
    ]);
  });
  it("a multi-segment ambiguous key needs all its segments, in order", () => {
    expect(scanSkillText("penguin greet world once", "s/SKILL.md", ambiguous)).toHaveLength(1);
    expect(scanSkillText("penguin greet", "s/SKILL.md", ["greet.world"])).toEqual([]);
  });
  it("an exec line is the fix, not the problem — never reported", () => {
    expect(scanSkillText("Use `penguin exec @acme/one greet`.", "s/SKILL.md", ambiguous)).toEqual(
      [],
    );
  });
  it("calls of unambiguous commands stay unreported", () => {
    expect(
      scanSkillText("penguin update fast\npenguin config model ls", "s/SKILL.md", ambiguous),
    ).toEqual([]);
  });
});

/** One fixture plugin package: manifest table with `cli.commands`, skills included. */
async function writePlugin(
  dir: string,
  name: string,
  contributes: unknown[],
  skills: Record<string, string> = {},
): Promise<string> {
  const pkgDir = path.join(dir, "pkgs", ...name.split("/"));
  const entry = path.join(pkgDir, "index.mjs");
  await fs.promises.mkdir(pkgDir, { recursive: true });
  await fs.promises.writeFile(
    path.join(pkgDir, "package.json"),
    JSON.stringify({ name, type: "module", main: "./index.mjs" }),
    "utf8",
  );
  await fs.promises.writeFile(
    path.join(pkgDir, "ifaces.json"),
    JSON.stringify({
      ifaces: {},
      types: {},
      modules: {
        [`${name}#Main`]: {
          name: `${name}#Main`,
          requires: {},
          provides: {},
          contributes: { "cli.commands": contributes },
          children: [],
        },
      },
      plugin: { modules: [`${name}#Main`], replaces: [] },
    }),
    "utf8",
  );
  // The code half is never imported by the review; the entry exists for completeness.
  await fs.promises.writeFile(entry, "export default { modules: [] };\n", "utf8");
  for (const [rel, text] of Object.entries(skills)) {
    const file = path.join(pkgDir, rel);
    await fs.promises.mkdir(path.dirname(file), { recursive: true });
    await fs.promises.writeFile(file, text, "utf8");
  }
  return entry;
}

/** A data root with one Project listing the given fixture plugins. */
async function writeRoot(
  plugins: { name: string; contributes: unknown[]; skills?: Record<string, string> }[],
): Promise<string> {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "penguin-check-"));
  const specifiers: string[] = [];
  for (const plugin of plugins) {
    specifiers.push(await writePlugin(root, plugin.name, plugin.contributes, plugin.skills ?? {}));
  }
  const project = path.join(root, "p1");
  await fs.promises.mkdir(project, { recursive: true });
  await fs.promises.writeFile(
    path.join(project, ".project_config.toml"),
    `models = []\n[plugins]\n${specifiers.map((s) => `${JSON.stringify(s)} = "*"`).join("\n")}\n`,
    "utf8",
  );
  return root;
}

/** One valid data half, the short way. */
function entry(key: string, id = key): CliCommandEntry {
  return { id, key, summary: { en: `${key} (en)`, zh: `${key} (zh)` } };
}

const savedHome = process.env.PENGUIN_HOME;
let root: string | undefined;
afterEach(async () => {
  if (root !== undefined) await fs.promises.rm(root, { recursive: true, force: true });
  root = undefined;
  if (savedHome === undefined) delete process.env.PENGUIN_HOME;
  else process.env.PENGUIN_HOME = savedHome;
});

describe("penguin plugin check (the report over a fixture root)", () => {
  it("reports all three classes and exits 1", async () => {
    root = await writeRoot([
      {
        name: "@acme/one",
        contributes: [entry("greet")],
        skills: {
          "skills/greet/SKILL.md": "# Greeting\n\nRun `penguin greet world` to greet the world.\n",
        },
      },
      {
        name: "@acme/two",
        contributes: [entry("greet")],
        skills: {
          // The fixed spelling: names the package, never ambiguous — not reported.
          "skills/fixed/SKILL.md": "Use `penguin exec @acme/one greet` instead.\n",
        },
      },
      {
        name: "@acme/bad",
        contributes: [
          entry("update.fast"),
          entry("web.extra"),
          entry("bad.thing", "bad.thing.first"),
          entry("bad.thing", "bad.thing.second"),
          { id: "bad.quiet", key: "quiet" } as unknown as CliCommandEntry,
        ],
      },
    ]);
    process.env.PENGUIN_HOME = root;

    const { out, result } = await capture(process.stdout, () => cli(["plugin", "check"]));
    expect(result).toBe(1);
    // The ambiguous key, with both packages that contribute it.
    expect(out).toContain("Ambiguous keys");
    expect(out).toContain("greet — contributed by @acme/one, @acme/two");
    // Every refusal reason, rendered.
    expect(out).toContain("Invalid registrations");
    expect(out).toContain(
      "'update.fast': the root segment 'update' is reserved for the CLI itself",
    );
    expect(out).toMatch(/'web\.extra'.*@prismshadow\/penguin-server.*did not open/);
    expect(out).toContain("'bad.thing': the package registers this key more than once");
    expect(out).toContain("'quiet'");
    // The skill that calls the ambiguous command bare — file and line, the fixed one absent.
    expect(out).toContain("Skills that call an ambiguous command");
    expect(out).toContain("skills/greet/SKILL.md:3");
    expect(out).not.toContain("skills/fixed/SKILL.md");
  });

  it("a root with no problems answers clean and exits 0", async () => {
    root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "penguin-check-clean-"));
    process.env.PENGUIN_HOME = root;
    const { out, result } = await capture(process.stdout, () => cli(["plugin", "check"]));
    expect(result).toBe(0);
    expect(out).toContain("No problems found.");
  });
});
