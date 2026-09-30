/**
 * The interface comparison plugins and workflows share: a package's OWN table against this
 * platform's, decided by the TypeScript compiler, both for what it requires and for what
 * it provides.
 */
import { describe, expect, it } from "vitest";
import ts from "typescript";
import { parseManifest } from "@prismshadow/penguin-core/kernel";
import type { IfaceTable } from "@prismshadow/penguin-core/kernel";
import platformTable from "../src/ifaces.json" with { type: "json" };
import { checkIfaces, ifaceQuestions, renderDts } from "../src/plugin/iface-check.js";

const platform = platformTable as unknown as IfaceTable;
const LOG = "@prismshadow/penguin-server#Log";
const MAIN = "@prismshadow/penguin-server#WorkflowMain";

const manifest = parseManifest({
  name: "Demo",
  requires: { log: { iface: LOG }, local: { iface: "Sibling" } },
  provides: { main: MAIN },
});

/** The platform's table as the package would have copied it when it was compiled. */
function compiledAgainst(edit: (table: IfaceTable) => void): IfaceTable {
  const table = structuredClone(platform);
  edit(table);
  return table;
}

describe("interface check", () => {
  it("asks about the interfaces a manifest names with a package part, in both directions", () => {
    expect(ifaceQuestions([manifest])).toEqual([
      { module: "Demo", alias: "log", direction: "requires", key: LOG },
      { module: "Demo", alias: "main", direction: "provides", key: MAIN },
    ]);
  });

  it("passes a package compiled against this very platform", () => {
    expect(checkIfaces(ts, platform, platform, ifaceQuestions([manifest]))).toEqual({
      problems: [],
      uncompared: [],
    });
  });

  it("names a required interface that no longer fits, and a provided one", () => {
    const own = compiledAgainst((t) => {
      t.ifaces[LOG]!.methods["line"]!.params = [{ data: "number" }];
      t.ifaces[MAIN]!.methods["handle"]!.returns = { promise: { data: "string" } };
    });
    const { problems } = checkIfaces(ts, platform, own, ifaceQuestions([manifest]));
    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain(`Demo: requires.log '${LOG}'`);
    expect(problems[0]).toContain("TS2322");
    expect(problems[1]).toContain(`Demo: provides.main '${MAIN}'`);
  });

  it("lets the platform grow: a member the package never knew breaks nothing", () => {
    const own = compiledAgainst((t) => {
      t.ifaces[LOG]!.methods = { line: t.ifaces[LOG]!.methods["line"]! };
    });
    expect(checkIfaces(ts, platform, own, ifaceQuestions([manifest])).problems).toEqual([]);
  });

  it("never answers from the platform's entry when the package's table lacks one", () => {
    const own = compiledAgainst((t) => {
      delete t.ifaces[LOG];
    });
    // It is reported as uncompared; whether that fails the load is the caller's rule (a
    // workflow's does, a plugin's — whose table the generator does not fill yet — does not).
    expect(checkIfaces(ts, platform, own, ifaceQuestions([manifest]))).toEqual({
      problems: [],
      uncompared: [`Demo: requires.log '${LOG}'`],
    });
  });

  it("compares an opaque by its name: the same table on both sides is not a mismatch", () => {
    // Each side is rendered into its own file, so a brand keyed by `unique symbol` would be
    // two different symbols and the platform would stop fitting ITSELF. 43 of the table's
    // interfaces carry a non-library opaque, so this is the common case, not a corner.
    const opaque = "@prismshadow/penguin-server#TerminalSession";
    const withOpaque = compiledAgainst((t) => {
      t.ifaces[LOG]!.methods["line"]!.params = [{ opaque }];
    });
    expect(checkIfaces(ts, withOpaque, withOpaque, ifaceQuestions([manifest]))).toEqual({
      problems: [],
      uncompared: [],
    });
    // …and a DIFFERENT opaque is still a mismatch: the name is the identity.
    const renamed = compiledAgainst((t) => {
      t.ifaces[LOG]!.methods["line"]!.params = [{ opaque: "@prismshadow/penguin-server#Other" }];
    });
    const { problems } = checkIfaces(ts, withOpaque, renamed, ifaceQuestions([manifest]));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(`Demo: requires.log '${LOG}'`);
  });

  it("carries a stream's return type, so a change to it is not invisible", () => {
    const streaming = compiledAgainst((t) => {
      t.ifaces[LOG]!.methods["line"]!.returns = {
        stream: { data: "string" },
        returns: { data: "string" },
      };
    });
    const changed = compiledAgainst((t) => {
      t.ifaces[LOG]!.methods["line"]!.returns = {
        stream: { data: "string" },
        returns: { data: "number" },
      };
    });
    expect(renderDts(streaming, [LOG]).text).toContain("AsyncGenerator<");
    expect(checkIfaces(ts, streaming, changed, ifaceQuestions([manifest])).problems).toHaveLength(
      1,
    );
  });

  it("records a provided interface this platform does not know, rather than dropping it", () => {
    const own = compiledAgainst(() => undefined);
    const gone = compiledAgainst((t) => {
      delete t.ifaces[MAIN];
    });
    // Both halves are counted, so the caller's tally is the number of questions unanswered.
    expect(checkIfaces(ts, gone, own, ifaceQuestions([manifest]))).toEqual({
      problems: [],
      uncompared: [`Demo: provides.main '${MAIN}'`],
    });
  });

  it("does not refuse a package whose own table this renderer cannot read", () => {
    const odd = compiledAgainst((t) => {
      t.ifaces[LOG]!.methods["line"]!.params = [{ data: "number.integer" }];
    });
    const { problems, uncompared } = checkIfaces(ts, platform, odd, ifaceQuestions([manifest]));
    expect(problems).toEqual([]);
    expect(uncompared.join(" ")).toContain("number.integer");
  });

  it("renders every interface of the platform's table, refusing nothing it carries", () => {
    const keys = Object.keys(platform.ifaces);
    const { text, names } = renderDts(platform, keys);
    expect(names.size).toBe(keys.length);
    expect(text).not.toContain("never");
    // A construct with no TypeScript rendering is refused by name, not widened.
    const odd = compiledAgainst((t) => {
      t.ifaces[LOG]!.methods["line"]!.params = [{ data: "number.integer" }];
    });
    expect(() => renderDts(odd, [LOG])).toThrow(/number\.integer/);
  });
});
