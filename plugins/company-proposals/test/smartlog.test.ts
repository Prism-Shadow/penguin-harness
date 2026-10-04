/**
 * The PR graph's smartlog rows (smartlog.ts): newest on top, the main line in the node's own
 * column, each other line drawn right above its node in the column to the right and joining back
 * with `├─╯` (never a fan), the base branch a last row `~` with how far it moved on; and the same
 * rows out of buildGraph over the chain rules.
 */
import { describe, expect, it } from "vitest";
import type { ProposalGraphNode, ProposalGraphRow } from "@prismshadow/penguin-server/api";
import { buildGraph, type Comparison, type OpenPull } from "../src/pr-chain.js";
import { smartlogRows } from "../src/smartlog.js";

type Drawn = Parameters<typeof smartlogRows>[0][number];

const n = (key: string, parent: string | null, over: Partial<Drawn> = {}): Drawn => ({
  key,
  parent,
  stacked: true,
  onChain: true,
  stale: false,
  behind: 0,
  ...over,
});

/** The rows as the CLI prints them, each node row labelled with its key, the base with `dev`. */
const text = (rows: ProposalGraphRow[]): string[] =>
  rows.map((r) =>
    r.kind === "join"
      ? r.cells.join("").trimEnd()
      : `${r.cells.join("")} ${r.kind === "base" ? `dev${r.behind ? ` (behind ${r.behind})` : ""}` : r.key}`,
  );

describe("smartlogRows", () => {
  it("draws a trunk, two lines on one of its nodes one after another, and a single PR on the base", () => {
    const rows = smartlogRows(
      [
        n("web-mod-1", "", { stale: true, behind: 7 }),
        n("web-mod-6", "web-mod-1"),
        n("web-mod-7", "web-mod-6"),
        n("plugins-page", "web-mod-1", { onChain: false }),
        n("port-forwards", "web-mod-1", { onChain: false }),
        n("single", ""),
      ],
      null,
    );
    expect(text(rows)).toEqual([
      "○  web-mod-7",
      "○  web-mod-6",
      "│ ◌  plugins-page",
      "├─╯",
      "│ ◌  port-forwards",
      "├─╯",
      "○  web-mod-1",
      "│ ○  single",
      "├─╯",
      "~  dev (behind 7)",
    ]);
    expect(rows.filter((r) => r.kind === "join").map((r) => r.key)).toEqual([
      "web-mod-1",
      "web-mod-1",
      "",
    ]);
  });

  it("keeps the column for the child that leads to the top, even when it is shorter", () => {
    const rows = smartlogRows([n("a", ""), n("b", "a"), n("c", "b"), n("t", "a")], "t");
    expect(text(rows)).toEqual(["○  t", "│ ○  c", "│ ○  b", "├─╯", "○  a", "~  dev"]);
  });

  it("draws a line forking off a side line one column further right, the columns left of it passing", () => {
    // a ─ b (main) and a ─ s ─ (s2 main, x side)
    const rows = smartlogRows(
      [
        n("a", ""),
        n("b", "a"),
        n("bb", "b"),
        n("bbb", "bb"),
        n("s", "a"),
        n("s2", "s"),
        n("x", "s"),
      ],
      null,
    );
    expect(text(rows)).toEqual([
      "○  bbb",
      "○  bb",
      "○  b",
      "│ ○  s2",
      "│ │ ○  x",
      "│ ├─╯",
      "│ ○  s",
      "├─╯",
      "○  a",
      "~  dev",
    ]);
  });

  it("marks a node off the chain and one whose edge does not hold, and draws no row for one it cannot reach", () => {
    const rows = smartlogRows(
      [
        n("a", ""),
        n("b", "a"),
        n("c", "a", { stacked: false, onChain: false }),
        n("lost", null, { onChain: false }),
        n("loop1", "loop2", { onChain: false }),
        n("loop2", "loop1", { onChain: false }),
      ],
      "b",
    );
    expect(text(rows)).toEqual(["○  b", "│ ×  c", "├─╯", "○  a", "~  dev"]);
  });

  it("draws the base alone when there is nothing on it", () => {
    expect(text(smartlogRows([], null))).toEqual(["~  dev"]);
  });
});

describe("buildGraph's rows", () => {
  const sha = (c: string): string => c.repeat(40);
  const DEV = sha("0");
  const pull = (number: number, base: string, head: string): OpenPull => ({
    number,
    url: `https://github.com/acme/site/pull/${number}`,
    title: `PR ${number}`,
    draft: false,
    branch: `b${number}`,
    head,
    base,
  });
  const ahead: Comparison = {
    relation: "ahead",
    ahead: 1,
    behind: 0,
    mergeBase: null,
    empty: false,
  };

  it("draws every line on the base as a stack of its own, and a fork inside a stack as a side line", () => {
    // #1→#2→#3 with #4 forking off #1 and going nowhere; #5 alone on dev.
    const p = [
      pull(1, "dev", sha("a")),
      pull(2, "b1", sha("b")),
      pull(3, "b2", sha("c")),
      pull(4, "b1", sha("d")),
      pull(5, "dev", sha("e")),
    ];
    const compares: Record<string, Comparison> = {};
    for (const x of p) {
      const parent = x.base === "dev" ? DEV : p.find((y) => y.branch === x.base)!.head;
      compares[`${parent}...${x.head}`] = ahead;
    }
    const g = buildGraph({
      repo: "acme/site",
      base: { branch: "dev", head: DEV },
      pulls: p,
      origins: [],
      compare: (from, to) => compares[`${from}...${to}`],
      proposals: [],
      deployments: [],
      errors: [],
      checkedAt: "2026-10-04T00:00:00.000Z",
    });
    const label = (key: string) =>
      `#${(g.nodes as ProposalGraphNode[]).find((x) => x.key === key)!.number}`;
    expect(
      g.rows.map((r) =>
        r.kind === "join"
          ? r.cells.join("").trimEnd()
          : `${r.cells.join("")} ${r.kind === "base" ? "dev" : label(r.key)}`,
      ),
    ).toEqual(["○  #3", "○  #2", "│ ◌  #4", "├─╯", "○  #1", "│ ○  #5", "├─╯", "~  dev"]);
  });
});
