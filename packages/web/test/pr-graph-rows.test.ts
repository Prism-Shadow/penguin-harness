/**
 * features/proposals/pr-graph-rows.tsx's NodeListSection, via react-dom/server static markup
 * (node env, no DOM): the rows listed under the graph carry the page's deploy menu when the page
 * hands its row wrapper in — every listed PR gets its own menu button — and stay bare without it.
 * A branch node (an impl branch no PR is open on) reads as its branch with its proposal and stage,
 * and keeps the deploy menu. A stale bottom layer says how far the base branch moved on. An
 * off-chain node whose base names no node says what fixing it takes.
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ProposalGraphNode, ProposalGraphResponse } from "@prismshadow/penguin-server/api";
import { S } from "../src/lib/strings";
import { NodeListSection, NodeRow } from "../src/features/proposals/pr-graph-rows";
import { DeployableRow } from "../src/features/proposals/pr-graph-deploy";

const node = (number: number): ProposalGraphNode => ({
  key: `b${number}`,
  number,
  url: `https://github.com/acme/app/pull/${number}`,
  title: `PR ${number}`,
  draft: false,
  branch: `b${number}`,
  head: `h${number}`,
  base: "gone",
  parent: null,
  via: [],
  relation: "unknown",
  ahead: null,
  behind: null,
  stacked: false,
  stale: false,
  onChain: false,
  off: { reason: "no-base", at: null },
  fork: false,
  proposal: null,
  origins: [],
});

const nodes = [node(7), node(9)];
const graph: ProposalGraphResponse = {
  repo: "acme/app",
  base: { branch: "dev", head: null, fork: false },
  origins: [],
  nodes,
  top: null,
  tops: [],
  rows: [],
  ownRows: [],
  unplaced: [],
  errors: [],
  checkedAt: "2026-10-01T00:00:00.000Z",
  deployments: [],
};

const list = (wrapRow?: (n: ProposalGraphNode, row: ReactNode) => ReactNode) =>
  renderToStaticMarkup(
    createElement(NodeListSection, {
      graph,
      title: "Detached",
      info: "",
      nodes,
      onOpenProposal: () => {},
      wrapRow,
    }),
  );

/** The menu button's label as static markup spells it (React escapes the apostrophe). */
const menuLabel = (n: number | string) =>
  `${typeof n === "number" ? `#${n}` : n} · ${S.company.proposals.graph.deploy.menuTitle}`.replace(
    /'/g,
    "&#x27;",
  );

describe("NodeListSection", () => {
  it("gives every listed PR the deploy menu the page wraps its rows in", () => {
    const html = list((n, row) =>
      createElement(DeployableRow, {
        projectId: "p",
        orgId: "o",
        node: n,
        subject: `pr:acme/app#${n.number}`,
        onPick: () => {},
        children: row,
      }),
    );
    expect(html).toContain(`aria-label="${menuLabel(7)}"`);
    expect(html).toContain(`aria-label="${menuLabel(9)}"`);
  });

  it("lists bare rows when no wrapper is handed in", () => {
    const html = list();
    expect(html).toContain("PR 7");
    expect(html).not.toContain(menuLabel(7));
  });
});

describe("a branch node", () => {
  const branch: ProposalGraphNode = {
    ...node(0),
    key: "impl/graph",
    number: null,
    url: null,
    title: "Branch nodes",
    branch: "impl/graph",
    base: "dev",
    parent: "",
    stacked: true,
    onChain: true,
    off: null,
    proposal: { number: 184, title: "Branch nodes", status: "drafting" },
  };
  const withBranch: ProposalGraphResponse = {
    ...graph,
    nodes: [branch],
    top: "impl/graph",
    tops: ["impl/graph"],
  };

  it("shows its branch instead of a PR number, its proposal, its stage and the top mark", () => {
    const t = S.company.proposals.graph;
    const html = renderToStaticMarkup(
      createElement(NodeRow, { graph: withBranch, node: branch, onOpenProposal: () => {} }),
    );
    expect(html).toContain(`>${t.branchNode}<`);
    expect(html).not.toContain("href=");
    expect(html).toContain(t.proposalRef(184));
    expect(html).toContain(S.company.proposals.status.drafting);
    expect(html).toContain(`>${t.top}<`);
  });

  it("keeps the deploy menu, named by its branch", () => {
    const html = renderToStaticMarkup(
      createElement(DeployableRow, {
        projectId: "p",
        orgId: "o",
        node: branch,
        subject: "proposal:184",
        onPick: () => {},
        children: createElement(NodeRow, {
          graph: withBranch,
          node: branch,
          onOpenProposal: () => {},
        }),
      }),
    );
    expect(html).toContain(`aria-label="${menuLabel("impl/graph")}"`);
  });
});

describe("a stale layer", () => {
  const t = S.company.proposals.graph;
  const stale = (parent: string): ProposalGraphNode => ({
    ...node(5),
    base: parent === "" ? "dev" : "b4",
    parent,
    relation: "diverged",
    ahead: 2,
    behind: 3,
    stacked: true,
    stale: true,
    onChain: true,
    off: null,
  });
  const row = (n: ProposalGraphNode) =>
    renderToStaticMarkup(
      createElement(NodeRow, {
        graph: { ...graph, nodes: [n] },
        node: n,
        onOpenProposal: () => {},
      }),
    );

  it("on the base branch says the base moved on by how many commits", () => {
    const html = row(stale(""));
    expect(html).toContain(`>${t.staleBase("dev", 3)}<`);
    expect(html).not.toContain(`>${t.stale}<`);
  });

  it("above another layer keeps the plain stale mark", () => {
    const html = row(stale("b4"));
    expect(html).toContain(`>${t.stale}<`);
    expect(html).not.toContain(t.staleBase("dev", 3));
  });
});

describe("an off-chain node's detail", () => {
  const t = S.company.proposals.graph;
  /** A sentence as static markup spells it (React escapes the apostrophe). */
  const markup = (text: string) => text.replace(/'/g, "&#x27;");
  const row = (n: ProposalGraphNode) =>
    renderToStaticMarkup(
      createElement(NodeRow, {
        graph: { ...graph, nodes: [n] },
        node: n,
        onOpenProposal: () => {},
      }),
    );

  it("names a base nothing registers, and the proposal that registered it", () => {
    const html = row({
      ...node(7),
      off: { reason: "no-base", at: null, missing: "gone", by: { proposal: 184 } },
    });
    expect(html).toContain(markup(t.offMissing("gone", 184)));
  });

  it("names the proposal whose merged PR took the base off the graph, and the PR", () => {
    const html = row({
      ...node(7),
      off: {
        reason: "unread",
        at: null,
        missing: "feat/a",
        by: { proposal: 12, pr: "https://github.com/acme/app/pull/20" },
      },
    });
    expect(html).toContain(markup(t.offClaimed("feat/a", 12, "acme/app#20")));
  });

  it("says nothing more when the server gives no detail", () => {
    const html = row(node(7));
    expect(html).not.toContain(markup(t.offMissing("gone", null)));
  });
});
