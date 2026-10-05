/**
 * The PR graph's search and view (features/proposals/pr-graph-search.ts): Ctrl+F through the app's
 * shortcut dispatcher opens the search and is not intercepted again while the box has focus; a
 * query finds a PR number, a proposal number, a branch and both titles; Enter and Shift+Enter go
 * round the hits in drawing order; a target in a folded segment names the fold to open, and a
 * target the own view leaves out draws the whole graph while it is the target; closing (no target)
 * goes back to the own view. The own view is the default, "Show other PRs" draws everything, and
 * the toggle is remembered in a storage that may refuse.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ProposalGraphNode, ProposalGraphRow } from "@prismshadow/penguin-server/api";
import { handleShortcutKeydown, onCommand } from "../src/lib/shortcuts/dispatcher";
import { setPlatformForTests } from "../src/lib/shortcuts/platform";
import { configureKeybindingsStoreForTests } from "../src/lib/shortcuts/store";
import {
  drawnRows,
  graphSearchCommand,
  nodeMatches,
  readShowOthers,
  searchHits,
  segmentHolding,
  stepHit,
  writeShowOthers,
} from "../src/features/proposals/pr-graph-search";

const node = (
  key: string,
  parent: string,
  over: Partial<ProposalGraphNode> = {},
): ProposalGraphNode =>
  ({
    key,
    number: null,
    branch: key,
    title: key,
    parent,
    proposal: null,
    ...over,
  }) as ProposalGraphNode;

const row = (kind: ProposalGraphRow["kind"], key: string, cells: string[]): ProposalGraphRow => ({
  kind,
  key,
  cells,
  behind: null,
  connector: false,
});

// Ours: upstream #10 ← #213 (proposal 194, "Graph search") ← impl/next (proposal 195).
// Theirs: #300 "Fix the docs" alone on main.
const nodes = [
  node("feat/upstream", "", { number: 10, title: "Upstream groundwork" }),
  node("feat/graph-search", "feat/upstream", {
    number: 213,
    title: "PR graph search",
    proposal: { number: 194, title: "Graph search", status: "approved" },
  }),
  node("impl/next", "feat/graph-search", {
    proposal: { number: 195, title: "After the search", status: "drafting" },
  }),
  node("fix/docs", "", { number: 300, title: "Fix the docs" }),
];
const rows: ProposalGraphRow[] = [
  row("node", "impl/next", ["○ "]),
  row("node", "feat/graph-search", ["○ "]),
  row("node", "feat/upstream", ["○ "]),
  row("node", "fix/docs", ["│ ", "○ "]),
  row("join", "", ["├─", "╯ "]),
  row("base", "", ["~ "]),
];
const ownRows: ProposalGraphRow[] = [
  row("node", "impl/next", ["○ "]),
  row("node", "feat/graph-search", ["○ "]),
  { ...row("node", "feat/upstream", ["○ "]), connector: true },
  row("base", "", ["~ "]),
];
const graph = { rows, ownRows };

describe("the graph.search command", () => {
  const offs: Array<() => void> = [];
  beforeEach(() => {
    setPlatformForTests("linux");
    configureKeybindingsStoreForTests({
      storage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
      layout: null,
    });
  });
  afterEach(() => {
    for (const off of offs.splice(0)) off();
    setPlatformForTests(null);
    configureKeybindingsStoreForTests({ storage: null, layout: null });
  });

  const ctrlF = () => {
    const state = { defaultPrevented: false };
    handleShortcutKeydown({
      code: "KeyF",
      key: "f",
      ctrlKey: true,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      repeat: false,
      isComposing: false,
      defaultPrevented: false,
      preventDefault: () => {
        state.defaultPrevented = true;
      },
    } as unknown as KeyboardEvent);
    return state.defaultPrevented;
  };

  it("opens the search on Ctrl+F, and lets the browser's find through while the box has focus", () => {
    let opened = 0;
    let focused = false;
    offs.push(
      onCommand(
        "find.open",
        graphSearchCommand({
          focused: () => focused,
          open: () => {
            opened++;
            focused = true;
          },
        }),
      ),
    );
    expect(ctrlF()).toBe(true);
    expect([opened, focused]).toEqual([1, true]);
    // Again, with the box focused: not taken, not prevented.
    expect(ctrlF()).toBe(false);
    expect(opened).toBe(1);
  });

  it("leaves Ctrl+F to the browser on a page that registered no search", () => {
    expect(ctrlF()).toBe(false);
  });
});

describe("matching", () => {
  const graphSearch = nodes[1]!;

  it("finds a PR number, a proposal number, a branch and both titles", () => {
    for (const q of [
      "#213",
      "213",
      "proposal 194",
      "p194",
      "194",
      "graph-search",
      "PR GRAPH",
      "graph search",
    ]) {
      expect(nodeMatches(graphSearch, q), q).toBe(true);
    }
    for (const q of ["#194", "p213", "", "  ", "nothing like it"]) {
      expect(nodeMatches(graphSearch, q), q).toBe(false);
    }
  });

  it("lists the hits in drawing order, base first, the nodes the own view leaves out among them", () => {
    expect(searchHits(rows, nodes, "fix")).toEqual(["fix/docs"]);
    expect(searchHits(rows, nodes, "search")).toEqual(["feat/graph-search", "impl/next"]);
  });

  it("goes round the hits with Enter and Shift+Enter", () => {
    expect(stepHit(-1, 3, false)).toBe(0);
    expect([stepHit(0, 3, false), stepHit(2, 3, false)]).toEqual([1, 0]);
    expect([stepHit(0, 3, true), stepHit(1, 3, true)]).toEqual([2, 0]);
    expect(stepHit(0, 0, false)).toBe(-1);
  });

  it("names the folded segment its target sits in, so that segment opens", () => {
    // feat/upstream heads the run upstream → graph-search → impl/next.
    expect(segmentHolding(rows, nodes, "feat/graph-search")).toBe("feat/upstream");
    expect(segmentHolding(rows, nodes, "fix/docs")).toBe("fix/docs");
    expect(segmentHolding(rows, nodes, "nowhere")).toBeNull();
  });
});

describe("the own view", () => {
  it("draws the proposals and their connectors by default, everything with Show other PRs", () => {
    expect(drawnRows(graph, false, null)).toBe(ownRows);
    expect(drawnRows(graph, true, null)).toBe(rows);
  });

  it("draws everything while a search target is a node the own view leaves out, and goes back after", () => {
    expect(drawnRows(graph, false, "fix/docs")).toBe(rows);
    expect(drawnRows(graph, false, "feat/graph-search")).toBe(ownRows);
    // Esc: no target any more.
    expect(drawnRows(graph, false, null)).toBe(ownRows);
  });

  it("remembers the toggle per browser, and survives a storage that refuses", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
    expect(readShowOthers(storage)).toBe(false);
    writeShowOthers(storage, true);
    expect(readShowOthers(storage)).toBe(true);
    const refusing = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(readShowOthers(refusing)).toBe(false);
    expect(() => writeShowOthers(refusing, true)).not.toThrow();
    expect(readShowOthers(null)).toBe(false);
  });
});
