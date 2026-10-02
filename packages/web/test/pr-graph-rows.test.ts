/**
 * features/proposals/pr-graph-rows.tsx's NodeListSection, via react-dom/server static markup
 * (node env, no DOM): the rows listed under the graph carry the page's deploy menu when the page
 * hands its row wrapper in — every listed PR gets its own menu button — and stay bare without it.
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ProposalGraphNode, ProposalGraphResponse } from "@prismshadow/penguin-server/api";
import { S } from "../src/lib/strings";
import { NodeListSection } from "../src/features/proposals/pr-graph-rows";
import { DeployableRow } from "../src/features/proposals/pr-graph-deploy";

const node = (number: number): ProposalGraphNode => ({
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
const menuLabel = (n: number) =>
  `#${n} · ${S.company.proposals.graph.deploy.menuTitle}`.replace(/'/g, "&#x27;");

describe("NodeListSection", () => {
  it("gives every listed PR the deploy menu the page wraps its rows in", () => {
    const html = list((n, row) =>
      createElement(DeployableRow, {
        node: n,
        scripts: [],
        scriptsError: null,
        onPick: () => {},
        onAssociate: () => {},
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
