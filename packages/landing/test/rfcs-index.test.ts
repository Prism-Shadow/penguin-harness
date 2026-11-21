/**
 * The RFC index's reading of the documents' provenance markers and `request-for-comments` GitHub
 * PR status records.
 *
 * - A merged document (its marker names where it landed, or says it is native to this repository)
 *   links its in-site page, carrying the raw document the page renders.
 * - A document or PR record carried by an open, draft, or closed RFC PR links to that PR and
 *   carries no in-site page.
 * - A document whose marker names nothing and has no PR record is a draft without a link.
 * - An open RFC PR carrying a revision newer than the merged version is recorded as the entry's
 *   open revision.
 * - Build-time PR status refresh caches results for 24 hours and never re-fetches merged PRs.
 */
import { describe, expect, it, vi } from "vitest";
import {
  compareSemver,
  extractRfcVersion,
  MAX_AGE_MS,
  refreshRfcPrStatusCache,
} from "../scripts/rfcs/pr-status.mjs";
import {
  buildRfcIndex,
  buildRfcSearchRecords,
  buildRfcTree,
  collapsibleRfcTreeKeys,
  compareRfcVersionTuple,
  countRfcTreeDescendantEntries,
  findRfcSearchMatchRanges,
  isMajorRfcVersion,
  isValidRfcSemver,
  readRfcTreeCollapsed,
  RFC_TREE_COLLAPSED_STORAGE_KEY,
  rfcBodyMarkdown,
  rfcEntries,
  rfcEntryOf,
  rfcEntryShortTitle,
  rfcEntryTitle,
  rfcPagerFor,
  rfcTree,
  searchRfcRecords,
  shortRfcNumber,
  shortRfcTitle,
  writeRfcTreeCollapsed,
} from "../src/lib/rfcs";
import type { RfcTreeNode } from "../src/lib/rfcs";
import { rfcIndexMarkdown } from "../src/pages/rfcs";

const DESIGN_PR = "https://github.com/Prism-Shadow/penguin-harness-design/pull/12";
const UNMERGED_PR = "https://github.com/Prism-Shadow/penguin-harness-design/pull/279";

const landedEn = [
  "# PRFC-0001 Module",
  "",
  "[中文版](PRFC-0001-module.zh.md)",
  "",
  "> **Source**: `rfcs/PRFC-0001-module.md` from the design repository — landed (default branch `main`, commit `ac673a24`).",
  "> **Rev**: v1.0.0 (migrated into the main repository).",
  "",
  "- Feature Name: `module`",
  "",
  "## Motivation",
  "",
  "One module system for the harness.",
].join("\n");

const landedZh = [
  "# PRFC-0001 模块",
  "",
  "[English](PRFC-0001-module.md)",
  "",
  "> **来源**：设计仓的 `rfcs/PRFC-0001-module.md`——落地于默认分支 `main`（提交 `ac673a24`）。",
  "",
  "- Feature Name: `module`",
  "",
  "## 动机",
].join("\n");

const nativeLanded = [
  "# PRFC-0021 Distro Channels",
  "",
  "- Feature Name: `distro-channels`",
  "- Start Date: 2026-10-23",
  "- PRFC PR: none yet (native to this repository)",
  "",
  "## Summary",
].join("\n");

const openDraft = [
  "# PRFC-0005 Plugin Versioning",
  "",
  "- Feature Name: `plugin-versioning`",
  "- PRFC PR: [Prism-Shadow/penguin-harness-design#12](https://github.com/Prism-Shadow/penguin-harness-design/pull/12)",
  "",
  "## Summary",
].join("\n");

const landedWithUnmerged = landedEn
  .replace("PRFC-0001 Module", "PRFC-0003 Plugin")
  .replace("PRFC-0001-module.md", "PRFC-0003-plugin.md")
  .replace("PRFC-0001-module.zh.md", "PRFC-0003-plugin.zh.md")
  .replace("PRFC-0001", "PRFC-0003")
  .replace(
    "\n\n## Motivation",
    "\n> **Unmerged revision**: the open design PR [#279](https://github.com/Prism-Shadow/penguin-harness-design/pull/279) carries one unmerged revision against this document.\n\n## Motivation",
  );

const drafting = ["# PRFC-0006 A Draft", "", "- Feature Name: `a-draft`", "", "## Summary"].join(
  "\n",
);

describe("buildRfcIndex", () => {
  it("classifies a landed document as merged and links into the in-site page", () => {
    const entry = buildRfcIndex({ "PRFC-0001-module.md": landedEn })[0]!;
    expect(entry.status).toBe("merged");
    expect(entry.title).toBe("PRFC-0001 Module");
    expect(entry.number).toBe("PRFC-0001");
    expect(entry.en?.href).toBe("/rfcs/PRFC-0001-module");
    expect(entry.en?.file).toBe("PRFC-0001-module.md");
    expect(entry.en?.raw).toContain("# PRFC-0001 Module");
    expect(entry.zh).toBeUndefined();
  });

  it("reads the Chinese marker too, and a native document is merged", () => {
    const index = buildRfcIndex({
      "PRFC-0001-module.zh.md": landedZh,
      "PRFC-0021-distros.md": nativeLanded,
    });
    expect(index.map((entry) => entry.number)).toEqual(["PRFC-0001", "PRFC-0021"]);
    expect(index[0]!.status).toBe("merged");
    expect(index[0]!.titleZh).toBe("PRFC-0001 模块");
    expect(index[0]!.zh?.href).toBe("/rfcs/PRFC-0001-module.zh");
    expect(index[1]!.status).toBe("merged");
  });

  it("a document carried by an open design PR links to that PR, not the repository", () => {
    const entry = buildRfcIndex({ "PRFC-0005-plugin-versioning.md": openDraft })[0]!;
    expect(entry.status).toBe("open");
    expect(entry.en?.href).toBe(DESIGN_PR);
    expect(entry.en?.href).not.toContain("/blob/main/");
  });

  it("a document with no marker is draft and shows without a link", () => {
    const entry = buildRfcIndex({ "PRFC-0006-a-draft.md": drafting })[0]!;
    expect(entry.status).toBe("draft");
    expect(entry.en).toBeUndefined();
    expect(entry.zh).toBeUndefined();
  });

  it("an open design PR carrying a newer revision is the entry's open revision, unless settled", () => {
    const entry = buildRfcIndex({ "PRFC-0003-plugin.md": landedWithUnmerged })[0]!;
    expect(entry.status).toBe("merged");
    expect(entry.openRevision?.href).toBe(UNMERGED_PR);

    const settledEntry = buildRfcIndex({ "PRFC-0003-plugin.md": landedWithUnmerged }, [
      {
        number: 279,
        title: "docs(rfcs): closed unmerged revision",
        url: UNMERGED_PR,
        status: "closed",
        baseRefName: "main",
        headRefOid: "sha-closed",
        rfcs: [{ id: "PRFC-0003-plugin", number: "PRFC-0003", title: "PRFC-0003 Plugin" }],
      },
    ])[0]!;
    expect(settledEntry.openRevision).toBeUndefined();

    const closedDraftEntry = buildRfcIndex({ "PRFC-0005-plugin-versioning.md": openDraft }, [
      {
        number: 12,
        title: "docs(rfcs): closed draft",
        url: DESIGN_PR,
        status: "closed",
        baseRefName: "main",
        headRefOid: "sha-12",
        rfcs: [
          {
            id: "PRFC-0005-plugin-versioning",
            number: "PRFC-0005",
            title: "PRFC-0005 Plugin Versioning",
          },
        ],
      },
    ])[0]!;
    expect(closedDraftEntry.status).toBe("closed");
    expect(closedDraftEntry.en).toBeUndefined();
  });

  it("merges request-for-comments GitHub PR records and ignores non-main base branches", () => {
    const index = buildRfcIndex({ "PRFC-0001-module.md": landedEn }, [
      {
        number: 1229,
        title: "docs(rfcs): draft RFC PRFC-0004 - plugin scope",
        url: "https://github.com/Prism-Shadow/penguin-harness/pull/1229",
        status: "open",
        baseRefName: "main",
        headRefOid: "abc",
        rfcs: [
          {
            id: "PRFC-0004-plugin-scope",
            number: "PRFC-0004",
            title: "PRFC-0004 Plugin Scope",
            titleZh: "PRFC-0004 插件的作用域",
          },
        ],
      },
      {
        number: 1559,
        title: "docs: define module, pass, and plugin semantics",
        url: "https://github.com/Prism-Shadow/penguin-harness/pull/1559",
        status: "merged",
        baseRefName: "feat/compile-module-pass",
        headRefOid: "def",
        rfcs: [
          {
            id: "PRFC-0025-module-pass",
            number: "PRFC-0025",
            title: "PRFC-0025 Module Pass: immutable operators before boot",
          },
        ],
      },
      {
        number: 1560,
        title: "feat: add module passes",
        url: "https://github.com/Prism-Shadow/penguin-harness/pull/1560",
        status: "draft",
        baseRefName: "main",
        headRefOid: "ghi",
        rfcs: [
          {
            id: "PRFC-0025-module-pass",
            number: "PRFC-0025",
            title: "PRFC-0025 Module Pass: immutable operators before boot",
          },
        ],
      },
    ]);
    expect(index.map((e) => [e.id, e.status])).toEqual([
      ["PRFC-0001-module", "merged"],
      ["PRFC-0004-plugin-scope", "open"],
      ["PRFC-0025-module-pass", "draft"],
    ]);
    expect(index[1]!.prNumber).toBe(1229);
    expect(index[1]!.prTitle).toBe("docs(rfcs): draft RFC PRFC-0004 - plugin scope");
    expect(index[1]!.prHref).toBe("https://github.com/Prism-Shadow/penguin-harness/pull/1229");
    expect(index[2]!.prNumber).toBe(1560);
    expect(index[2]!.prHref).toBe("https://github.com/Prism-Shadow/penguin-harness/pull/1560");
    expect(rfcEntryShortTitle(index[2]!, "en")).toBe("Module Pass");
  });

  it("validates SemVer 2.0 RFC versions and identifies major RFC versions", () => {
    for (const v of [
      "v0.0.1",
      "v0.0.2",
      "v0.1.0",
      "v0.2.0",
      "v1.0.0",
      "v1.0.0-alpha.1",
      "v1.2.0",
      "v2.0.0",
    ]) {
      expect(isValidRfcSemver(v)).toBe(true);
    }
    for (const bad of ["v0.0.0", "v0.1", "v1", "1.0.0", "v01.0.0", "v1.0.0-01", ""]) {
      expect(isValidRfcSemver(bad)).toBe(false);
    }

    for (const major of [
      "v0.0.1",
      "v0.0.2",
      "v0.1",
      "v0.1.0",
      "v0.2",
      "v0.2.0",
      "v1",
      "v1.0.0",
      "v2",
      "v2.0.0",
      "v2.0.0+build.1",
    ]) {
      expect(isMajorRfcVersion(major)).toBe(true);
    }
    for (const nonMajor of ["v0.0.0", "v0.1.2", "v1.0.0-alpha.1", "v1.1.0", "v1.2.0", "v2.3.0"]) {
      expect(isMajorRfcVersion(nonMajor)).toBe(false);
    }

    expect(compareSemver("v1.0.0-rc.2", "v1.0.0-rc.10")).toBeLessThan(0);
    expect(compareSemver("v1.0.0-rc.10", "v1.0.0")).toBeLessThan(0);
    expect(compareRfcVersionTuple("v1.0.0-rc.2", "v1.0.0-rc.10")).toBeLessThan(0);
    expect(compareRfcVersionTuple("v1.0.0+20261120", "v2.0.0+20260101")).toBeLessThan(0);
    expect(
      extractRfcVersion(
        ["> **Rev**: v1.0.0-rc.2", "", "## Changes", "", "### v1.0.0-rc.10", "- Candidate 10"].join(
          "\n",
        ),
      ),
    ).toBe("v1.0.0-rc.10");
  });

  it("orders multiple major-version PRs by semantic version rather than PR number", () => {
    const index = buildRfcIndex({ "PRFC-0001-module.md": landedEn }, [
      {
        number: 1200,
        title: "docs(rfcs): PRFC-0001 v2.0.0",
        url: "https://github.com/Prism-Shadow/penguin-harness/pull/1200",
        status: "merged",
        baseRefName: "main",
        headRefOid: "sha-v2",
        rfcs: [
          {
            id: "PRFC-0001-module",
            number: "PRFC-0001",
            title: "PRFC-0001 Module",
            version: "v2.0.0+build.1",
          },
        ],
      },
      {
        number: 1500,
        title: "docs(rfcs): PRFC-0001 v1.0.0 backfill",
        url: "https://github.com/Prism-Shadow/penguin-harness/pull/1500",
        status: "merged",
        baseRefName: "main",
        headRefOid: "sha-v1",
        rfcs: [
          {
            id: "PRFC-0001-module",
            number: "PRFC-0001",
            title: "PRFC-0001 Module",
            version: "v1.0.0",
          },
        ],
      },
    ]);
    expect(index[0]!.prNumber).toBe(1200);
  });

  it("selects the last major version PR as main and collects non-main opening PRs as child editions", () => {
    const index = buildRfcIndex({ "PRFC-0003-plugin.md": landedWithUnmerged }, [
      {
        number: 1228,
        title: "docs(rfcs): move the landed design RFCs into the repository",
        url: "https://github.com/Prism-Shadow/penguin-harness/pull/1228",
        status: "merged",
        baseRefName: "main",
        headRefOid: "sha1",
        rfcs: [
          {
            id: "PRFC-0003-plugin",
            number: "PRFC-0003",
            title: "PRFC-0003 Plugin",
            version: "v1.0.0",
          },
        ],
      },
      {
        number: 1480,
        title: "docs(rfcs): align PRFC-0003 to v1.1.0",
        url: "https://github.com/Prism-Shadow/penguin-harness/pull/1480",
        status: "merged",
        baseRefName: "main",
        headRefOid: "sha2",
        rfcs: [
          {
            id: "PRFC-0003-plugin",
            number: "PRFC-0003",
            title: "PRFC-0003 Plugin",
            version: "v1.1.0",
          },
        ],
      },
      {
        number: 1560,
        title: "feat: add module passes and verified reconfiguration semantics",
        url: "https://github.com/Prism-Shadow/penguin-harness/pull/1560",
        status: "draft",
        baseRefName: "main",
        headRefOid: "sha3",
        rfcs: [
          {
            id: "PRFC-0003-plugin",
            number: "PRFC-0003",
            title: "PRFC-0003 Plugin",
          },
        ],
      },
    ]);
    expect(index[0]!.prNumber).toBe(1228);
    expect(index[0]!.openEditions).toEqual([
      {
        number: 1560,
        title: "feat: add module passes and verified reconfiguration semantics",
        url: "https://github.com/Prism-Shadow/penguin-harness/pull/1560",
        status: "draft",
      },
    ]);
  });

  it("populates all 21 active RFCs in rfcEntries with their major-version main PR and opening editions", () => {
    expect(rfcEntries).toHaveLength(21);
    const mod = rfcEntries.find((e) => e.id === "PRFC-0001-module");
    expect(mod?.status).toBe("merged");
    expect(mod?.prNumber).toBe(1228);
    expect(mod?.openEditions?.map((p) => p.number)).toEqual([1560]);

    const plugin = rfcEntries.find((e) => e.id === "PRFC-0003-plugin");
    expect(plugin?.prNumber).toBe(1228);
    expect(plugin?.openEditions?.map((p) => p.number)).toEqual([1560]);

    expect(rfcEntries.find((e) => e.id === "PRFC-0014-workflow")?.prNumber).toBe(1228);
    expect(rfcEntries.find((e) => e.id === "PRFC-0019-rsi-toolkits")?.prNumber).toBe(1228);

    expect(rfcEntries.find((e) => e.id === "PRFC-0004-plugin-scope")?.status).toBe("open");
    expect(
      rfcEntries.find((e) => e.id === "PRFC-0005-mechanisms-not-implementations"),
    ).toBeUndefined();
    expect(rfcEntries.find((e) => e.id === "PRFC-0005-plugin-versioning")?.status).toBe("open");
    const apiSocket = rfcEntries.find((e) => e.id === "PRFC-0011-single-socket");
    expect(rfcEntryShortTitle(apiSocket!, "en")).toBe("API Socket");
    expect(rfcEntryShortTitle(apiSocket!, "zh")).toBe("API Socket");

    const cliMod = rfcEntries.find((e) => e.id === "PRFC-0024-cli-modules");
    expect(cliMod?.prNumber).toBe(1523);
    expect(cliMod?.openEditions).toEqual([
      {
        number: 1649,
        title: "docs(rfcs): PRFC-0024 v1.2.0 — shipped plugins' CLI modules (impl #1645)",
        url: "https://github.com/Prism-Shadow/penguin-harness/pull/1649",
        status: "open",
        version: "v1.2.0",
      },
    ]);
    expect(rfcEntries.find((e) => e.id === "PRFC-0025-module-pass")?.status).toBe("draft");
  });

  it("organizes all 21 active RFCs and their opening edition PRs into the tree view", () => {
    expect(rfcTree.map((n) => n.label)).toEqual(["Meta", "Modules & Plugins", "Harness"]);
    const collectIds = (nodes: readonly RfcTreeNode[]): string[] =>
      nodes.flatMap((n) => [...(n.entry ? [n.entry.id] : []), ...collectIds(n.children ?? [])]);
    const treeIds = collectIds(rfcTree);
    expect(treeIds).toHaveLength(rfcEntries.length);
    expect(new Set(treeIds)).toEqual(new Set(rfcEntries.map((e) => e.id)));

    const collectEditionPrNumbers = (nodes: readonly RfcTreeNode[]): number[] =>
      nodes.flatMap((n) => [
        ...(n.editionPr ? [n.editionPr.number] : []),
        ...collectEditionPrNumbers(n.children ?? []),
      ]);
    expect(collectEditionPrNumbers(rfcTree)).toEqual([1560, 1649, 1560]);

    const customTree = buildRfcTree(rfcEntries);
    expect(customTree).toHaveLength(3);
    const md = rfcIndexMarkdown("en");
    expect(md).toContain("- **Meta**");
    expect(md).toContain("- **Modules & Plugins**");
    expect(md).toContain("- **Harness**");
    expect(md).toContain("([#1228](https://github.com/Prism-Shadow/penguin-harness/pull/1228))");
    expect(md).toContain(
      "- [#1649 docs(rfcs): PRFC-0024 v1.2.0 — shipped plugins' CLI modules (impl #1645)](https://github.com/Prism-Shadow/penguin-harness/pull/1649)",
    );
    expect(md).not.toContain("| --- |");
  });

  it("computes collapsible keys, descendant entry counts, and persists collapsed state", () => {
    const keys = collapsibleRfcTreeKeys(rfcTree);
    expect(keys).toEqual([
      "meta",
      "modules-and-plugins",
      "PRFC-0001-module",
      "PRFC-0024-cli-modules",
      "PRFC-0003-plugin",
      "harness",
      "observability",
      "agent",
      "PRFC-0014-workflow",
      "runtime",
      "distribution",
      "PRFC-0021-distros",
    ]);
    expect(rfcTree.map((n) => countRfcTreeDescendantEntries(n))).toEqual([1, 8, 12]);

    const store = new Map<string, string>();
    const mockStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
    };

    const validSet = new Set(keys);
    expect([...readRfcTreeCollapsed(validSet, mockStorage)]).toEqual([]);
    writeRfcTreeCollapsed(["PRFC-0001-module", "runtime"], mockStorage);
    expect(store.get(RFC_TREE_COLLAPSED_STORAGE_KEY)).toBe('["PRFC-0001-module","runtime"]');
    expect([...readRfcTreeCollapsed(validSet, mockStorage)]).toEqual([
      "PRFC-0001-module",
      "runtime",
    ]);
    store.set(RFC_TREE_COLLAPSED_STORAGE_KEY, '["PRFC-0001-module","unknown-key",42]');
    expect([...readRfcTreeCollapsed(validSet, mockStorage)]).toEqual(["PRFC-0001-module"]);
  });

  it("resolves RFC entries by exact id, registered slug alias, or unique bare PRFC number", () => {
    expect(rfcEntryOf("PRFC-0024-cli-modules")?.id).toBe("PRFC-0024-cli-modules");
    expect(rfcEntryOf("PRFC-0024-cli-resolution")?.id).toBe("PRFC-0024-cli-modules");
    expect(rfcEntryOf("PRFC-0024")?.id).toBe("PRFC-0024-cli-modules");
    expect(rfcEntryOf("PRFC-0024-unknown-typo")).toBeUndefined();
    expect(rfcEntryOf("PRFC-9999-nonexistent")).toBeUndefined();
  });

  it("merges the language pair into one entry and skips non-PRFC files", () => {
    const index = buildRfcIndex({
      "PRFC-0001-module.md": landedEn,
      "PRFC-0001-module.zh.md": landedZh,
      "README.md": "# Design RFCs (PRFC)",
      "TEMPLATE.md": "# PRFC-NNNN Title",
    });
    expect(index).toHaveLength(1);
    expect(index[0]!.id).toBe("PRFC-0001-module");
    expect(index[0]!.title).toBe("PRFC-0001 Module");
    expect(index[0]!.titleZh).toBe("PRFC-0001 模块");
  });

  it("extracts short numbers, short titles, and locale-aware titles", () => {
    const entry = buildRfcIndex({
      "PRFC-0001-module.md": landedEn,
      "PRFC-0001-module.zh.md": landedZh,
    })[0]!;
    expect(shortRfcNumber("PRFC-0001")).toBe("0001");
    expect(shortRfcTitle("PRFC-0001 Module")).toBe("Module");
    expect(shortRfcTitle("PRFC-0024: CLI Modules")).toBe("CLI Modules");
    expect(shortRfcTitle("PRFC-0008 Telemetry: Let the System Itself Say")).toBe("Telemetry");
    expect(rfcEntryTitle(entry, "en")).toBe("PRFC-0001 Module");
    expect(rfcEntryTitle(entry, "zh")).toBe("PRFC-0001 模块");
    expect(rfcEntryShortTitle(entry, "en")).toBe("Module");
    expect(rfcEntryShortTitle(entry, "zh")).toBe("模块");
  });

  it("strips the leading H1 and language-switch link from the body Markdown", () => {
    const body = rfcBodyMarkdown(landedEn);
    expect(body).not.toContain("# PRFC-0001 Module");
    expect(body).not.toContain("[中文版]");
    expect(body).toContain("> **Source**:");
    expect(body).toContain("## Motivation");
  });

  it("builds previous/next pagination across the index and merged RFCs", () => {
    const fromIndex = rfcPagerFor("index", "en", "RFC index");
    expect(fromIndex.prev).toBeUndefined();
    expect(fromIndex.next?.href).toBe("/rfcs/PRFC-0001-module");
    const fromFirst = rfcPagerFor("PRFC-0001-module", "en", "RFC index");
    expect(fromFirst.prev).toEqual({ id: "index", href: "/rfcs", title: "RFC index" });
    expect(fromFirst.next?.href).toBe("/rfcs/PRFC-0002-hmr");
  });

  it("indexes sections for search, skips fenced code blocks, and highlights query match ranges", () => {
    const records = buildRfcSearchRecords("en", {
      title: "RFC index",
      body: [
        "Every design decision is recorded as an RFC.",
        "",
        "````md",
        "```sh",
        "## FakeFenceHeading",
        "unsearchable_fence_token_xyz",
        "```",
        "````",
        "",
        "## The RFCs",
        "",
        "Module and Plugin with `snake_case_identifier`.",
      ].join("\n"),
    });
    expect(searchRfcRecords(records, "FakeFenceHeading")).toEqual([]);
    expect(searchRfcRecords(records, "unsearchable_fence_token_xyz")).toEqual([]);
    expect(searchRfcRecords(records, "snake_case_identifier")).toHaveLength(1);
    const hits = searchRfcRecords(records, "module");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((h) => h.record.href === "/rfcs/PRFC-0001-module")).toBe(true);
    const ranges = findRfcSearchMatchRanges("PRFC-0001 Module system", "module");
    expect(ranges).toEqual([{ start: 10, end: 16 }]);
  });
});

describe("refreshRfcPrStatusCache optimizations", () => {
  const baseTime = Date.parse("2026-11-20T00:00:00.000Z");
  const sampleCache = {
    updatedAt: new Date(baseTime).toISOString(),
    prs: [
      {
        number: 1228,
        title: "docs(rfcs): move the landed design RFCs into the repository",
        url: "https://github.com/Prism-Shadow/penguin-harness/pull/1228",
        status: "merged" as const,
        baseRefName: "main",
        headRefOid: "sha-merged",
        rfcs: [
          {
            id: "PRFC-0001-module",
            number: "PRFC-0001",
            title: "PRFC-0001 Module",
            version: "v1.0.0",
          },
        ],
      },
      {
        number: 1229,
        title: "docs(rfcs): draft RFC PRFC-0004 - plugin scope",
        url: "https://github.com/Prism-Shadow/penguin-harness/pull/1229",
        status: "open" as const,
        baseRefName: "main",
        headRefOid: "sha-open",
        rfcs: [
          {
            id: "PRFC-0004-plugin-scope",
            number: "PRFC-0004",
            title: "PRFC-0004 Plugin Scope",
            version: "v1.0.0",
          },
        ],
      },
    ],
  };

  it("reuses the cache without querying GitHub when younger than 24 hours", () => {
    const graphql = vi.fn();
    const result = refreshRfcPrStatusCache({
      cache: sampleCache,
      now: baseTime + MAX_AGE_MS - 1000,
      graphql,
    });
    expect(result.fetched).toBe(false);
    expect(result.cache).toBe(sampleCache);
    expect(graphql).not.toHaveBeenCalled();
  });

  it("after 24 hours, queries open and newly merged PRs without re-fetching cached merged blobs", () => {
    const graphql = vi.fn((query: string) => {
      if (query.includes("b_0:")) {
        return {
          repository: {
            b_0: { text: "# PRFC-0026 New Merged\n\n> **Rev**: v1.0.0\n\n## Summary\n" },
          },
        };
      }
      return {
        repository: {
          openPrs: { nodes: [] },
          mergedPrs: {
            nodes: [
              {
                number: 1228,
                title: "docs(rfcs): move the landed design RFCs into the repository",
                url: "https://github.com/Prism-Shadow/penguin-harness/pull/1228",
                state: "MERGED",
                isDraft: false,
                baseRefName: "main",
                headRefOid: "sha-merged",
                files: { nodes: [{ path: "rfcs/PRFC-0001-module.md" }] },
              },
              {
                number: 1680,
                title: "docs(rfcs): add PRFC-0026",
                url: "https://github.com/Prism-Shadow/penguin-harness/pull/1680",
                state: "MERGED",
                isDraft: false,
                baseRefName: "main",
                headRefOid: "sha-1680",
                files: { nodes: [{ path: "rfcs/PRFC-0026-new-merged.md" }] },
              },
            ],
          },
          pr_1229: {
            number: 1229,
            title: "docs(rfcs): draft RFC PRFC-0004 - plugin scope",
            url: "https://github.com/Prism-Shadow/penguin-harness/pull/1229",
            state: "MERGED",
            isDraft: false,
            baseRefName: "main",
            headRefOid: "sha-open",
            files: { nodes: [{ path: "rfcs/PRFC-0004-plugin-scope.md" }] },
          },
        },
      };
    });
    const result = refreshRfcPrStatusCache({
      cache: sampleCache,
      now: baseTime + MAX_AGE_MS + 1000,
      graphql,
    });
    expect(result.fetched).toBe(true);
    expect(graphql).toHaveBeenCalledTimes(2);
    const prQuery = String(graphql.mock.calls[0]?.[0] ?? "");
    expect(prQuery).toContain("states: [OPEN]");
    expect(prQuery).toContain("states: [MERGED]");
    expect(prQuery).toContain("pr_1229: pullRequest(number: 1229)");
    expect(prQuery).not.toContain("pr_1228");
    const blobQuery = String(graphql.mock.calls[1]?.[0] ?? "");
    expect(blobQuery).toContain("sha-1680:rfcs/PRFC-0026-new-merged.md");
    expect(blobQuery).not.toContain("sha-merged");
    expect(result.cache.prs.map((p) => [p.number, p.status])).toEqual([
      [1228, "merged"],
      [1229, "merged"],
      [1680, "merged"],
    ]);
  });
});
