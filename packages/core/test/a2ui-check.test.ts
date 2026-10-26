/**
 * The whole-reply check (a2ui/check.ts), its report (a2ui/report.ts) and the CLI's argument
 * handling (a2ui/cli.ts): L1 issues carry absolute lines and the block index, the L2 heuristics
 * fire on overuse / a question that is not last / an unintroduced block / a snapshot with no
 * time, the text outside the blocks raises nothing, and the total is L2: the gate passes a reply
 * with two block warnings and stops one with three.
 */
import { describe, expect, it } from "vitest";
import { A2UI_RUBRIC, checkReply, formatReport } from "../src/a2ui/index.js";
import { runCli, type CliIo } from "../src/a2ui/cli.js";

const callout = '```a2ui\n{"type":"callout","tone":"note","text":"Keep the console open."}\n```';
const choice = [
  "```a2ui",
  '{"type":"choice","question":"Which store?","options":[{"label":"SQLite","recommended":true},{"label":"PostgreSQL"}]}',
  "```",
].join("\n");
const good = `I found two ways to store the sessions.\n\nWhich store do you want?\n\n${choice}\n`;

describe("checkReply", () => {
  it("a grounded choice that ends the reply scores 100", () => {
    const report = checkReply(good);
    expect(report.ok).toBe(true);
    expect(report.issues).toEqual([]);
    expect(report.blocks).toEqual([{ index: 1, fence: "a2ui", type: "choice", ok: true }]);
    expect(report.score).toEqual({ l1: 100, l2: 100, total: 100 });
    expect(report.lang).toBe("en");
  });

  it("L1 issues carry the block index, the absolute line and scope l1; any error zeroes the total", () => {
    const report = checkReply("Intro.\n\n```mermaid\nflowchart LR\n  A[x( --> B\n```\n");
    const unbalanced = report.issues.filter((i) => i.code === "mermaid_unbalanced");
    expect(unbalanced.length).toBeGreaterThan(0);
    expect(unbalanced.every((i) => i.block === 1 && i.line === 5 && i.scope === "l1")).toBe(true);
    expect(report.ok).toBe(false);
    expect(report.blocks[0]).toEqual({ index: 1, fence: "mermaid", ok: false });
    expect(report.score.l1).toBe(0);
    expect(report.score.total).toBe(0);
  });

  it("an unclosed fence is an error; an invalid block still reports the type it named", () => {
    const unclosed = checkReply('Intro.\n\n```a2ui\n{"type":"callout","tone":"note","text":"t"}');
    expect(unclosed.issues.map((i) => [i.level, i.code, i.block])).toEqual([
      ["error", "unclosed_fence", 1],
    ]);
    const unknown = checkReply('Intro.\n\n```a2ui\n{"type":"table"}\n```');
    expect(unknown.blocks[0]).toEqual({ index: 1, fence: "a2ui", type: "table", ok: false });
    expect(unknown.issues.map((i) => i.code)).toEqual(["unknown_type"]);
  });

  it("L2: more than 4 blocks is overuse", () => {
    const report = checkReply(`Note.\n\n${callout}\n\n`.repeat(5));
    expect(report.issues.map((i) => [i.code, i.scope])).toEqual([["ui_overuse", "l2"]]);
  });

  it("L2: content after a choice, and a block no sentence introduces", () => {
    const notLast = checkReply(`Pick one.\n\n${choice}\n\nLet me know.`);
    expect(notLast.issues.map((i) => [i.code, i.block])).toEqual([["interactive_not_last", 1]]);
    const heading = checkReply(`## Options\n\n${callout}`);
    expect(heading.issues.map((i) => i.code)).toEqual(["ungrounded_block"]);
    expect(checkReply(callout).issues.map((i) => i.code)).toEqual(["ungrounded_block"]);
    expect(checkReply(`Here is a note.\n\n${callout}`).issues).toEqual([]);
  });

  it("L2: a snapshot without `asOf`; a widget is no question, so prose may follow it", () => {
    const fence = (spec: object) => `\`\`\`a2ui\n${JSON.stringify(spec)}\n\`\`\``;
    const metrics = { type: "metrics", items: [{ label: "CPU", value: 37, max: 100, unit: "%" }] };
    const bare = checkReply(`Here is the machine now.\n\n${fence(metrics)}\n`);
    expect(bare.issues.map((i) => [i.code, i.block, i.line])).toEqual([["no_as_of", 1, 3]]);
    const dated = fence({ ...metrics, asOf: "2026-10-04T06:05:00Z" });
    expect(checkReply(`Here is the machine now.\n\n${dated}\n`).issues).toEqual([]);
    const weather = fence({
      type: "weather",
      place: "Beijing",
      condition: "rain",
      temp: 12,
      asOf: "2026-10-04T14:05+08:00",
    });
    expect(checkReply(`Here is the weather.\n\n${weather}\n\nTake an umbrella.`).issues).toEqual(
      [],
    );
  });

  it("L2: a resources board is a snapshot and needs `asOf`; a chart need not be one", () => {
    const fence = (spec: object) => `\`\`\`a2ui\n${JSON.stringify(spec)}\n\`\`\``;
    const board = fence({ type: "resources", cpu: { percent: 37 } });
    expect(checkReply(`Here is the machine now.\n\n${board}\n`).issues.map((i) => i.code)).toEqual([
      "no_as_of",
    ]);
    const chart = fence({
      type: "chart",
      kind: "bar",
      categories: ["Mon", "Tue"],
      series: [{ label: "Builds", values: [12, 9] }],
    });
    expect(checkReply(`Here are this week's builds.\n\n${chart}\n`).issues).toEqual([]);
  });

  it("scores: each block warning costs L2 15 points, and the total is L2 when there is no error", () => {
    expect(checkReply(callout).score).toEqual({ l1: 100, l2: 85, total: 85 });
  });

  it("the text outside the blocks raises nothing: a passive, vague, long reply scores 100", () => {
    const prose = [
      "The file is written by the loader, and various other things are done appropriately etc.",
      "This sentence keeps going with one more clause and then another clause and yet another clause until it passes any limit on length that a checker could ever set.",
    ].join(" ");
    const report = checkReply(`${prose}\n\n- a\n  - b\n    - c\n`);
    expect(report.issues).toEqual([]);
    expect(report.blocks).toEqual([]);
    expect(report.score).toEqual({ l1: 100, l2: 100, total: 100 });
  });
});

/** A reply of `n` callouts, each under a heading, so each is one `ungrounded_block` warning. */
const ungrounded = (n: number) =>
  Array.from({ length: n }, (_, i) => `## Note ${i + 1}\n\n${callout}`).join("\n\n");

describe("formatReport", () => {
  it("prints the summary, the block list, each issue with its place, the score and the rubric", () => {
    const text = formatReport(checkReply(callout), { rubric: true });
    expect(text).toContain("a2ui check: 1 block, 0 errors, 1 warning (lang en)");
    expect(text).toContain("block 1: a2ui callout — ok");
    expect(text).toContain("warnings — blocks (L2):");
    expect(text).toContain("[block 1 line 1] ungrounded_block:");
    expect(text).toContain("score: L1 100  L2 85  total 85  (pass)");
    expect(text).not.toContain("prose");
    expect(text).toContain("self-review before sending:");
    expect(text).toContain(`1. ${A2UI_RUBRIC.en[0]}`);
  });

  it("passes a reply with two block warnings and stops one with three", () => {
    expect(formatReport(checkReply(ungrounded(2)))).toContain("total 70  (pass)");
    expect(formatReport(checkReply(ungrounded(3)))).toContain(
      "total 55  (below the 70 gate; fix the warnings that matter)",
    );
  });

  it("says when a reply has no block at all", () => {
    const text = formatReport(checkReply("Just an answer."));
    expect(text).toContain("a2ui check: 0 blocks, 0 errors, 0 warnings (lang en)");
    expect(text).toContain("  no a2ui or mermaid blocks");
    expect(text).toContain("score: L1 100  L2 100  total 100  (pass)");
  });

  it("says why the total is 0 and prints the zh rubric for a zh reply", () => {
    const text = formatReport(checkReply('下面是说明。\n\n```a2ui\n{"type":"nope"}\n```'), {
      rubric: true,
    });
    expect(text).toContain("errors (fix before sending):");
    expect(text).toContain("total 0  (total is 0 while any error remains)");
    expect(text).toContain(`1. ${A2UI_RUBRIC.zh[0]}`);
  });
});

describe("runCli", () => {
  const io = (stdin: string) => {
    const out: string[] = [];
    const err: string[] = [];
    const cli: CliIo = {
      readStdin: () => stdin,
      stdinIsTTY: false,
      readFile: (file) => {
        throw new Error(`ENOENT: ${file}`);
      },
      out: (text) => out.push(text),
      err: (text) => err.push(text),
    };
    return { cli, out, err };
  };

  it("reads stdin, prints JSON or the text report with the rubric, and exits 0 without errors", () => {
    const json = io(good);
    expect(runCli(["--json"], json.cli)).toBe(0);
    expect(JSON.parse(json.out[0]!)).toMatchObject({ ok: true, score: { total: 100 } });
    const text = io(good);
    expect(runCli(["--rubric", "--lang=en"], text.cli)).toBe(0);
    expect(text.out[0]).toContain("self-review before sending:");
  });

  it("--lang picks the rubric's language over the reply's own", () => {
    const zh = io(good);
    expect(runCli(["--rubric", "--lang", "zh"], zh.cli)).toBe(0);
    expect(zh.out[0]).toContain("(lang zh)");
    expect(zh.out[0]).toContain(`1. ${A2UI_RUBRIC.zh[0]}`);
    const json = io(good);
    runCli(["--json", "--lang=zh"], json.cli);
    expect(JSON.parse(json.out[0]!)).toMatchObject({ lang: "zh" });
  });

  it("exits 1 on an error, 2 on a bad option or an unreadable file", () => {
    expect(runCli([], io('```a2ui\n{"type":"nope"}\n```').cli)).toBe(1);
    const bad = io(good);
    expect(runCli(["--lang", "xx"], bad.cli)).toBe(2);
    expect(bad.err[0]).toContain("--lang must be");
    expect(runCli(["missing.md"], io(good).cli)).toBe(2);
  });
});
