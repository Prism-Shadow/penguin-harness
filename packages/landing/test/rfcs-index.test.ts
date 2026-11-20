/**
 * The RFC index's reading of the documents' provenance markers.
 *
 * - A landed document (its marker names where it landed, or says it is native to this repository)
 *   links into the repository's own copy of each language version.
 * - A document carried by an open design PR links to that PR and carries no repository links.
 * - A document whose marker names nothing is drafting: the row shows without a link.
 * - An open design PR carrying a revision newer than the landed version is recorded as the
 *   entry's open revision.
 * - The English and Chinese versions of one document merge into one entry, sorted by number;
 *   the index skips files that are not PRFC documents (the surface's README and template).
 */
import { describe, expect, it } from "vitest";
import { buildRfcIndex } from "../src/lib/rfcs";

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
    // The marker lives in the header, under the Source block — as the real PRFC-0003 carries it.
    "\n> **Unmerged revision**: the open design PR [#279](https://github.com/Prism-Shadow/penguin-harness-design/pull/279) carries one unmerged revision against this document.\n\n## Motivation",
  );

const drafting = [
  "# PRFC-0006 A Draft",
  "",
  "- Feature Name: `a-draft`",
  "",
  "## Summary",
].join("\n");

describe("buildRfcIndex", () => {
  it("classifies a landed document by its marker and links into the repository", () => {
    const [entry] = buildRfcIndex({ "PRFC-0001-module.md": landedEn });
    expect(entry.status).toBe("landed");
    expect(entry.title).toBe("PRFC-0001 Module");
    expect(entry.number).toBe("PRFC-0001");
    expect(entry.en?.href).toBe(
      "https://github.com/Prism-Shadow/penguin-harness/blob/main/rfcs/PRFC-0001-module.md",
    );
    expect(entry.zh).toBeUndefined();
  });

  it("reads the Chinese marker too, and a native document is landed", () => {
    const index = buildRfcIndex({
      "PRFC-0001-module.zh.md": landedZh,
      "PRFC-0021-distros.md": nativeLanded,
    });
    expect(index.map((entry) => entry.number)).toEqual(["PRFC-0001", "PRFC-0021"]);
    expect(index[0].status).toBe("landed");
    expect(index[0].titleZh).toBe("PRFC-0001 模块");
    expect(index[0].zh?.href).toBe(
      "https://github.com/Prism-Shadow/penguin-harness/blob/main/rfcs/PRFC-0001-module.zh.md",
    );
    expect(index[1].status).toBe("landed");
  });

  it("a document carried by an open design PR links to that PR, not the repository", () => {
    const [entry] = buildRfcIndex({ "PRFC-0005-plugin-versioning.md": openDraft });
    expect(entry.status).toBe("open");
    expect(entry.en?.href).toBe(DESIGN_PR);
    expect(entry.en?.href).not.toContain("/blob/main/");
  });

  it("a document with no marker is drafting and shows without a link", () => {
    const [entry] = buildRfcIndex({ "PRFC-0006-a-draft.md": drafting });
    expect(entry.status).toBe("drafting");
    expect(entry.en).toBeUndefined();
    expect(entry.zh).toBeUndefined();
  });

  it("an open design PR carrying a newer revision is the entry's open revision", () => {
    const [entry] = buildRfcIndex({ "PRFC-0003-plugin.md": landedWithUnmerged });
    expect(entry.status).toBe("landed");
    expect(entry.openRevision?.href).toBe(UNMERGED_PR);
  });

  it("merges the language pair into one entry and skips non-PRFC files", () => {
    const index = buildRfcIndex({
      "PRFC-0001-module.md": landedEn,
      "PRFC-0001-module.zh.md": landedZh,
      "README.md": "# Design RFCs (PRFC)",
      "TEMPLATE.md": "# PRFC-NNNN Title",
    });
    expect(index).toHaveLength(1);
    expect(index[0].id).toBe("PRFC-0001-module");
    expect(index[0].title).toBe("PRFC-0001 Module");
    expect(index[0].titleZh).toBe("PRFC-0001 模块");
  });
});
