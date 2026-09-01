/**
 * Long-form documentation for the builtin registry's entries, keyed by package specifier.
 *
 * Each backend owns its own README.md — the file its package directory shows and `files`
 * ships. This module inlines those four at build time, the way `builtin-index.json` beside
 * it inlines the listing: the text becomes a string in the bundle, so the harness still
 * depends on no backend at runtime (see the sandbox plugins' own module docs) and no
 * second copy of the prose exists to drift from the first.
 *
 * Kept out of `builtin-index.json` because the shapes differ: the index is a listing, sent in
 * full on every page load, while a readme is large and wanted only for the one entry someone
 * opened — which is why the registry serves it through a call of its own.
 *
 * Markdown, rendered by the Web App's plugin detail page. `test/plugin-registry.test.ts`
 * pins this map to the index, so an entry can gain neither a readme without a listing nor a
 * listing without a readme.
 */
import bwrap from "../../../../plugins/sandbox-bwrap/README.md";
import dsh from "../../../../plugins/sandbox-dsh/README.md";
import mxc from "../../../../plugins/sandbox-mxc/README.md";
import seatbelt from "../../../../plugins/sandbox-seatbelt/README.md";

export const BUILTIN_READMES: Readonly<Record<string, string>> = {
  "@prismshadow/penguin-plugin-sandbox-bwrap": bwrap,
  "@prismshadow/penguin-plugin-sandbox-seatbelt": seatbelt,
  "@prismshadow/penguin-plugin-sandbox-mxc": mxc,
  "@prismshadow/penguin-plugin-sandbox-dsh": dsh,
};
