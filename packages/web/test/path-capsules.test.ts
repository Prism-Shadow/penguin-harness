/**
 * Data paths in a ticket's text (features/company/path-capsules.ts and path-capsule.tsx): which
 * stretches are paths — the `<app_data_dir>` placeholder, an absolute path through this
 * Project's data directory, a code span holding one path — where one stops against the
 * punctuation and CJK around it, folder or file, and the capsules the ticket Markdown draws
 * for them (react-dom/server static markup, node env).
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  codePath,
  pathKind,
  pathLabel,
  spellAsWritten,
  splitPaths,
} from "../src/features/company/path-capsules";
import type { PathPiece } from "../src/features/company/path-capsules";
import { PathMarkdown, PathText } from "../src/features/company/path-capsule";
import { S } from "../src/lib/strings";

const scope = { projectId: "default_project" };
const LAB = "<app_data_dir>/organizations/co_research_paper_lab";
/** Where a server on Windows puts the same organization: a drive, backslashes, a dot directory. */
const WIN_LAB = String.raw`C:\Users\ada\.penguin\data\default_project\organizations\co_lab`;

/** A string as React writes it into an attribute. */
const attr = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** How many capsules a render drew, told apart from other buttons (a code block's copy) by their accessible name. */
const capsuleCount = (html: string) =>
  html.split(`aria-label="${S.company.pathCapsule.copy("")}`).length - 1;

const paths = (text: string) =>
  splitPaths(text, scope).flatMap((p) => (p.kind === "path" ? [p.path] : []));

describe("splitPaths", () => {
  it("splits prose into text and path pieces, in order", () => {
    expect(splitPaths(`See ${LAB}/workspace/experiments/dep-eval/ for the runs.`, scope)).toEqual([
      { kind: "text", text: "See " },
      { kind: "path", path: `${LAB}/workspace/experiments/dep-eval/` },
      { kind: "text", text: " for the runs." },
    ]);
  });

  it("returns one text piece for text with no path", () => {
    expect(splitPaths("nothing here", scope)).toEqual([{ kind: "text", text: "nothing here" }]);
    expect(splitPaths("", scope)).toEqual([]);
  });

  it("keeps CJK text and full-width punctuation outside the path", () => {
    expect(paths(`结果写在${LAB}/workspace/report.md。`)).toEqual([`${LAB}/workspace/report.md`]);
    expect(paths(`见（${LAB}/workspace/exp/），然后`)).toEqual([`${LAB}/workspace/exp/`]);
    expect(paths(`目录：${LAB}/handbook/里有说明`)).toEqual([`${LAB}/handbook/`]);
  });

  it("leaves a sentence's trailing punctuation out of the path", () => {
    expect(paths(`Done in ${LAB}/workspace/exp.`)).toEqual([`${LAB}/workspace/exp`]);
    expect(paths(`(${LAB}/workspace/exp), next`)).toEqual([`${LAB}/workspace/exp`]);
    expect(paths(`${LAB}/workspace/a.csv, ${LAB}/workspace/b.csv; done`)).toEqual([
      `${LAB}/workspace/a.csv`,
      `${LAB}/workspace/b.csv`,
    ]);
    expect(paths(`"${LAB}/workspace/exp/"...`)).toEqual([`${LAB}/workspace/exp/`]);
  });

  it("finds several paths, in order", () => {
    const text = `Compare ${LAB}/workspace/v1/ and ${LAB}/workspace/v2/, then write <app_data_dir>/agents/co_lab_ceo/agent_state/AGENTS.md`;
    expect(paths(text)).toEqual([
      `${LAB}/workspace/v1/`,
      `${LAB}/workspace/v2/`,
      "<app_data_dir>/agents/co_lab_ceo/agent_state/AGENTS.md",
    ]);
  });

  it("takes an absolute path that runs through this Project's data directory", () => {
    const abs = "/home/ada/.penguin/data/default_project/organizations/co_lab/workspace/site/";
    expect(paths(`Built into ${abs} today`)).toEqual([abs]);
    expect(paths("~/.penguin/data/default_project/agents/co_lab_ceo/scratchpad/notes.md")).toEqual([
      "~/.penguin/data/default_project/agents/co_lab_ceo/scratchpad/notes.md",
    ]);
    expect(paths("C:/Users/ada/.penguin/data/default_project/organizations/co_lab/x.json")).toEqual(
      ["C:/Users/ada/.penguin/data/default_project/organizations/co_lab/x.json"],
    );
  });

  it("takes a Windows path, written with backslashes or with both separators", () => {
    const report = String.raw`${WIN_LAB}\workspace\report.md`;
    expect(paths(`结果在${report}。`)).toEqual([report]);
    const desk =
      String.raw`C:\Users\ada\.penguin\data\default_project\agents\co_lab_ceo\scratchpad` + "\\";
    expect(paths(`Notes in ${desk} for now`)).toEqual([desk]);
    const mixed = String.raw`C:\Users\ada/.penguin/data\default_project\organizations/co_lab\x.json`;
    expect(paths(`(${mixed})`)).toEqual([mixed]);
    const exp = String.raw`<app_data_dir>\organizations\co_lab\exp` + "\\";
    expect(paths(`Done in ${exp}.`)).toEqual([exp]);
  });

  it("leaves other Windows paths alone", () => {
    expect(paths(String.raw`C:\Users\ada\Documents\report.md`)).toEqual([]);
    expect(paths(String.raw`D:\penguin\other_project\organizations\co_lab\x`)).toEqual([]);
  });

  it("leaves other absolute paths, routes and URLs alone", () => {
    expect(paths("GET /api/v1/organizations/co_lab/tickets returns 200")).toEqual([]);
    expect(
      paths("GET /api/projects/default_project/organizations/co_lab/tickets/T-12 returned 404"),
    ).toEqual([]);
    expect(paths("/home/ada/.penguin/data/other_project/organizations/co_lab/x")).toEqual([]);
    expect(paths("https://example.test/default_project/organizations/co_lab/x")).toEqual([]);
    expect(paths("and/or 1/2 <app_data_dir>/")).toEqual([]);
  });

  it("does not start a path in the middle of a word, but does after a colon", () => {
    expect(paths(`prefix${LAB}/x`)).toEqual([]);
    expect(paths("key=/home/ada/default_project/organizations/co_lab/x")).toEqual([]);
    expect(paths(`Output:${LAB}/workspace/out/`)).toEqual([`${LAB}/workspace/out/`]);
  });

  it("stops at a space", () => {
    expect(paths(`${LAB}/workspace/my notes/`)).toEqual([`${LAB}/workspace/my`]);
  });

  it("leaves a path that runs on through a non-ASCII segment as text, rather than capsuling its parent", () => {
    expect(paths(`结果在 ${LAB}/workspace/调研报告.md`)).toEqual([]);
    expect(paths(`${LAB}/workspace/实验/`)).toEqual([]);
    expect(paths(`${LAB}/workspace/report实验.md`)).toEqual([]);
    expect(paths(`见 ${LAB}/workspace/exp/，数据在 ${LAB}/workspace/数据/a.csv`)).toEqual([
      `${LAB}/workspace/exp/`,
    ]);
    // Prose that resumes after a folder goes on to no `/` or extension, so the folder is kept.
    expect(paths(`目录：${LAB}/handbook/里有说明`)).toEqual([`${LAB}/handbook/`]);
    expect(paths(String.raw`${WIN_LAB}\workspace\调研\a.md`)).toEqual([]);
  });

  it("leaves the tail of a path that runs in from a non-ASCII segment as text", () => {
    const home =
      String.raw`C:\Users\张三\.penguin\data\default_project\organizations\co_lab\workspace` + "\\";
    expect(paths(home)).toEqual([]);
    expect(paths("/home/张三/.penguin/data/default_project/organizations/co_lab/x.md")).toEqual([]);
    // CJK right before a root is the sentence, not a segment: no separator comes before it.
    const site = "/home/ada/.penguin/data/default_project/organizations/co_lab/site/";
    expect(paths(`构建到${site}了`)).toEqual([site]);
  });

  it("keeps a whole <placeholder> segment inside the path", () => {
    expect(paths("<app_data_dir>/agents/<agent_id>/agent_state/skills/")).toEqual([
      "<app_data_dir>/agents/<agent_id>/agent_state/skills/",
    ]);
  });
});

describe("codePath", () => {
  it("reads a code span that is one path, verbatim", () => {
    expect(codePath(`${LAB}/workspace/exp/`, scope)).toBe(`${LAB}/workspace/exp/`);
    expect(codePath(` ${LAB}/workspace/实验/结果.md `, scope)).toBe(
      `${LAB}/workspace/实验/结果.md`,
    );
    expect(codePath(`${LAB}/workspace/v1.`, scope)).toBe(`${LAB}/workspace/v1.`);
  });

  it("leaves a command, a route and a bare word as code", () => {
    expect(codePath(`ls ${LAB}/workspace`, scope)).toBeNull();
    expect(codePath(`${LAB}/run.sh --fast`, scope)).toBeNull();
    expect(codePath("/api/v1/tickets", scope)).toBeNull();
    expect(codePath("/api/projects/default_project/agents/ceo/schedules", scope)).toBeNull();
    expect(codePath("penguin", scope)).toBeNull();
    expect(codePath(String.raw`dir ${WIN_LAB}\workspace`, scope)).toBeNull();
  });

  it("reads a code span holding one Windows path, verbatim", () => {
    const exp = String.raw`${WIN_LAB}\workspace\exp` + "\\";
    expect(codePath(exp, scope)).toBe(exp);
    const mixed = String.raw`C:\Users\ada/.penguin/data\default_project\agents\ceo/notes.md`;
    expect(codePath(mixed, scope)).toBe(mixed);
  });
});

describe("pathLabel and pathKind", () => {
  it("labels a path by its last segment", () => {
    expect(pathLabel(`${LAB}/workspace/experiments/dep-eval/`)).toBe("dep-eval");
    expect(pathLabel(`${LAB}/workspace/report.md`)).toBe("report.md");
    expect(pathLabel("<app_data_dir>/")).toBe("");
  });

  it("splits a Windows path on either separator", () => {
    expect(pathLabel(String.raw`${WIN_LAB}\workspace\report.md`)).toBe("report.md");
    expect(pathLabel(String.raw`${WIN_LAB}\workspace\dep-eval` + "\\")).toBe("dep-eval");
    expect(pathLabel(String.raw`${WIN_LAB}/workspace\x.json`)).toBe("x.json");
    expect(pathLabel(String.raw`${WIN_LAB}\workspace/x.json`)).toBe("x.json");
  });

  it("reads a trailing slash as a folder, an extension as a file, and anything else as a folder", () => {
    expect(pathKind(`${LAB}/workspace/dep-eval/`)).toBe("folder");
    expect(pathKind(`${LAB}/workspace/dep-eval`)).toBe("folder");
    expect(pathKind(`${LAB}/workspace/report.md`)).toBe("file");
    expect(pathKind(`${LAB}/workspace/run.v2.json`)).toBe("file");
    expect(pathKind(`${LAB}/workspace/archive.tar.gz/`)).toBe("folder");
    expect(pathKind(String.raw`${WIN_LAB}\workspace\archive.tar.gz` + "\\")).toBe("folder");
    expect(pathKind(String.raw`${WIN_LAB}\workspace\report.md`)).toBe("file");
  });
});

describe("spellAsWritten", () => {
  it("spells a path holding a backslash as the Markdown source does, any other as the text does", () => {
    const pieces: PathPiece[] = [
      { kind: "text", text: "see " },
      { kind: "path", path: String.raw`C:\x\ada.penguin\default_project\organizations\a` },
      { kind: "text", text: " and " },
      { kind: "path", path: "/x/default_project/organizations/co_lab" },
    ];
    const source = String.raw`see C:\x\ada\.penguin\default_project\organizations\a and /x/default_project/organizations/co\_lab`;
    expect(spellAsWritten(pieces, source)).toEqual([
      pieces[0],
      { kind: "path", path: String.raw`C:\x\ada\.penguin\default_project\organizations\a` },
      pieces[2],
      pieces[3],
    ]);
    // A spelling the source does not hold (an entity stood in for a character) keeps the text's.
    expect(spellAsWritten(pieces, "see C:&#92;x")).toEqual(pieces);
  });
});

describe("ticket Markdown with capsules", () => {
  const render = (text: string) =>
    renderToStaticMarkup(createElement(PathMarkdown, { text, scope }));

  it("draws a path in prose as a capsule labelled by its last segment, the full path in the tooltip", () => {
    const html = render(`结果在 ${LAB}/workspace/experiments/dep-eval/。`);
    expect(capsuleCount(html)).toBe(1);
    expect(html).toContain(">dep-eval</span></button>");
    expect(html).toContain(`title="${LAB.replace(/</g, "&lt;").replace(/>/g, "&gt;")}`);
    expect(html).toContain("。");
    expect(html).not.toContain(
      "organizations/co_research_paper_lab/workspace/experiments/dep-eval/。",
    );
  });

  it("draws an inline code span holding one path as a capsule, and leaves a command as code", () => {
    const html = render(`Open \`${LAB}/workspace/a.md\` or run \`ls ${LAB}/workspace\``);
    expect(capsuleCount(html)).toBe(1);
    expect(html).toContain(">a.md</span></button>");
    expect(html).toContain(
      "<code>ls &lt;app_data_dir&gt;/organizations/co_research_paper_lab/workspace</code>",
    );
  });

  it("keeps a fenced block verbatim", () => {
    const html = render(`\`\`\`\n${LAB}/workspace/exp/\n\`\`\``);
    expect(capsuleCount(html)).toBe(0);
    expect(html).toContain("co_research_paper_lab/workspace/exp/");
  });

  it("keeps a link's label as text", () => {
    const html = render(`[${LAB}/workspace/exp/](https://example.test)`);
    expect(capsuleCount(html)).toBe(0);
  });

  it("finds paths inside list items and emphasis", () => {
    const html = render(`- **Data**: ${LAB}/workspace/data/\n- ${LAB}/workspace/b.csv`);
    expect(html).toContain(">data</span></button>");
    expect(html).toContain(">b.csv</span></button>");
  });

  it("leaves a path the parser split with emphasis whole as text rather than capsuling part of it", () => {
    const html = render(`${LAB}/workspace/src/__init__.py`);
    expect(capsuleCount(html)).toBe(0);
  });

  it("copies a Windows path in prose as written, though Markdown takes its `\\.` for an escape", () => {
    const report = String.raw`${WIN_LAB}\workspace\report.md`;
    const html = render(`结果在 ${report}。`);
    expect(capsuleCount(html)).toBe(1);
    expect(html).toContain(">report.md</span></button>");
    expect(html).toContain(`aria-label="${attr(S.company.pathCapsule.copy(report))}"`);
    expect(html).toContain("。");
  });

  it("copies a Windows path in a code span verbatim", () => {
    const desk = String.raw`${WIN_LAB}\workspace\exp` + "\\";
    const html = render(`Runs: \`${desk}\``);
    expect(capsuleCount(html)).toBe(1);
    expect(html).toContain(">exp</span></button>");
    expect(html).toContain(`aria-label="${attr(S.company.pathCapsule.copy(desk))}"`);
  });

  it("copies a path written with / as the text reads, without the source's escapes", () => {
    const html = render(String.raw`See ${LAB}/workspace/my\_notes/ now`);
    expect(capsuleCount(html)).toBe(1);
    const copied = S.company.pathCapsule.copy(`${LAB}/workspace/my_notes/`);
    expect(html).toContain(`aria-label="${attr(copied)}"`);
  });
});

describe("plain text with capsules", () => {
  it("draws the paths in a blocked reason and keeps the words around them", () => {
    const html = renderToStaticMarkup(
      createElement(PathText, { text: `等待 ${LAB}/workspace/gpu.lock 释放`, scope }),
    );
    expect(html).toContain("等待 ");
    expect(html).toContain(">gpu.lock</span></button>");
    expect(html).toContain(" 释放");
  });
});
