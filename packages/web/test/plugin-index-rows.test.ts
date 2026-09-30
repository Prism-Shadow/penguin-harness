/**
 * The Plugins page shows a name as one row, by the entry an install of it takes: the same
 * rule the server installs by (`pickIndexEntry`), not the first entry listed. The other
 * contents under the name are on its detail page.
 */
import { describe, expect, it } from "vitest";
import type { PluginIndexEntry } from "@prismshadow/penguin-server/api";
import { pickIndexEntry } from "@prismshadow/penguin-server/api";
import { moduleParts, indexEntryOf } from "../src/features/plugins/plugin-groups";

const hash = (c: string) => `sha256-${c.repeat(64)}`;
const entry = (version: string, integrity?: string): PluginIndexEntry => ({
  name: "@acme/sandbox-x",
  version,
  description: `v${version}`,
  authors: [],
  license: "MIT",
  ...(integrity !== undefined ? { integrity } : {}),
});

describe("one row per plugin name", () => {
  // In the merged index's order: the build's entry first, then two more contents of the same
  // version (another build's, one keyed before the archiver changed), then a higher version
  // this machine fetched, and one listed without an integrity.
  const index = [
    entry("1.0.0", hash("a")),
    entry("1.0.0", hash("b")),
    entry("1.0.0", hash("c")),
    entry("1.1.0", hash("d")),
    entry("2.0.0"),
  ];

  it("lists the name once, by the entry an install takes", () => {
    const rows = moduleParts(null, index);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.entry).toBe(index[3]);
    expect(rows[0]!.entry).toBe(pickIndexEntry(index, "@acme/sandbox-x", {}));
  });

  it("within one version, the entry listed first — the build's", () => {
    expect(indexEntryOf(index.slice(0, 3), "@acme/sandbox-x")).toBe(index[0]);
  });

  it("shows an entry nothing can install when that is all there is", () => {
    expect(indexEntryOf([index[4]!], "@acme/sandbox-x")).toBe(index[4]);
    expect(indexEntryOf(index, "@acme/other")).toBeUndefined();
  });
});
