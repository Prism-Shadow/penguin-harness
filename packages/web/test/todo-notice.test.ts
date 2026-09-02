/**
 * The shared page notice (src/components/ui/todo-notice.tsx) and the decisions behind its
 * bulk-update button (src/lib/bulk-update.ts).
 *
 * Three rules are defended here, and each is a rule rather than a preference because breaking it
 * produces a screen the user cannot reason about:
 *
 * 1. **The counts come off the raised to-do**, never a second calculation. A block claiming three
 *    updates under a dot raised for four is unresolvable from the outside.
 * 2. **The button opens a confirmation; it does not write.** A bulk overwrite is consented to
 *    before it runs, and every one of these pages already asks before overwriting a single
 *    object.
 * 3. **A partial failure names the targets that failed.** On a control whose entire point is
 *    "all of them at once", a count with no names leaves the user re-checking every row by hand.
 *
 * Rules 2 and 3's first half are source scans over the real JSX rather than render assertions —
 * vitest runs node-only here, so the thing that decays is a call site, not a component's output.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { bulkOutcome, failedList, firstFailure, noticeCounts } from "../src/lib/bulk-update";
import type { Todo } from "../src/lib/todo-badges";

const SRC = fileURLToPath(new URL("../src", import.meta.url));

function tsxFiles(dir = SRC, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) tsxFiles(path, out);
    else if (name.endsWith(".tsx")) out.push(path);
  }
  return out;
}

/** Every `<TodoNotice …>` in the app, as "relative/path" plus its attributes by name. */
function noticeSites(): { file: string; attrs: Map<string, string>; source: string }[] {
  const sites: { file: string; attrs: Map<string, string>; source: string }[] = [];
  for (const path of tsxFiles()) {
    const rel = path.slice(SRC.length + 1).replaceAll(sep, "/");
    const source = readFileSync(path, "utf8");
    const sf = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (node: ts.Node): void => {
      const opening = ts.isJsxSelfClosingElement(node)
        ? node
        : ts.isJsxElement(node)
          ? node.openingElement
          : null;
      if (opening !== null && opening.tagName.getText() === "TodoNotice") {
        const attrs = new Map<string, string>();
        for (const attr of opening.attributes.properties) {
          if (!ts.isJsxAttribute(attr)) continue;
          attrs.set(attr.name.getText(), attr.initializer?.getText() ?? "");
        }
        sites.push({ file: rel, attrs, source });
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  // The component's own definition is not a call site.
  return sites.filter((s) => s.file !== "components/ui/todo-notice.tsx");
}

describe("the notice block is the one shape on every page that has one", () => {
  const sites = noticeSites();

  it("is placed on all four dismissible trails and nowhere else", () => {
    expect(sites.map((s) => s.file).sort()).toEqual([
      "features/agents/agents-page.tsx",
      "features/models/models-page.tsx",
      "features/plugins/plugins-page.tsx",
      "features/usage/usage-page.tsx",
    ]);
  });

  it("never offers a bulk action without labelling it, or a label without an action", () => {
    for (const { file, attrs } of sites) {
      expect(attrs.has("actionLabel"), `${file} action label and handler must agree`).toBe(
        attrs.has("onAction"),
      );
    }
  });

  it("only the cost center omits the bulk action — nothing there can be updated", () => {
    const withAction = sites.filter((s) => s.attrs.has("onAction")).map((s) => s.file);
    expect(withAction.sort()).toEqual([
      "features/agents/agents-page.tsx",
      "features/models/models-page.tsx",
      "features/plugins/plugins-page.tsx",
    ]);
  });
});

describe("the bulk button confirms before it writes", () => {
  const withAction = noticeSites().filter((s) => s.attrs.has("onAction"));

  it("has a handler that opens something rather than calling the API", () => {
    for (const { file, attrs } of withAction) {
      const handler = attrs.get("onAction") ?? "";
      expect(handler, `${file}'s onAction must not write; it opens the confirmation`).not.toMatch(
        /\bapi\./,
      );
      expect(handler, `${file}'s onAction must not await a write`).not.toMatch(/\bawait\b/);
    }
  });

  it("flips a state that gates the batch's own ConfirmModal", () => {
    // Not "the file contains a ConfirmModal somewhere" — every one of these pages already had
    // one (a delete confirm, a group confirm) before this block existed, so that assertion is
    // true whether or not the batch confirms. What has to hold is the LINK: the state the
    // button sets is the state the dialog is rendered behind.
    for (const { file, attrs, source } of withAction) {
      const setter = /\bset([A-Z]\w*)\s*\(/.exec(attrs.get("onAction") ?? "");
      expect(
        setter,
        `${file}'s onAction must open the confirmation by setting state`,
      ).not.toBeNull();
      const state = setter![1]!.charAt(0).toLowerCase() + setter![1]!.slice(1);
      const guarded = new RegExp(`${state}[^\\n]*&&[\\s\\S]{0,400}?<ConfirmModal`);
      expect(
        guarded.test(source),
        `${file} must render its batch ConfirmModal behind ${state}`,
      ).toBe(true);
    }
  });
});

describe("noticeCounts", () => {
  const base = { signature: "s", items: ["s"], match: "set" } as const;

  it("reports the whole count as upgradable where the trail has no honest split", () => {
    // Agents and Skills: an Agent's kernel is never new, and a Skill nobody installed is not
    // waiting for anyone. The notice then states one number instead of padding with a zero.
    const todo: Todo = { ...base, items: ["a", "b", "c"], count: 3 };
    expect(noticeCounts(todo)).toEqual({ added: null, updated: 3 });
  });

  it("splits added from upgradable where the trail can tell them apart", () => {
    const todo: Todo = {
      ...base,
      items: ["a", "b"],
      count: 2,
      breakdown: { added: 1, updated: 1 },
    };
    expect(noticeCounts(todo)).toEqual({ added: 1, updated: 1 });
  });

  it("never reports more than the gate raised the dot for", () => {
    const todo: Todo = {
      ...base,
      items: ["a", "b"],
      count: 2,
      breakdown: { added: 2, updated: 0 },
    };
    const { added, updated } = noticeCounts(todo);
    expect((added ?? 0) + updated).toBe(todo.count);
  });
});

describe("bulkOutcome", () => {
  const ok = { status: "fulfilled", value: undefined } as const;
  const bad = (reason: string) => ({ status: "rejected", reason }) as const;

  it("is clean when every target took the write", () => {
    expect(bulkOutcome(["alpha", "beta"], [ok, ok])).toEqual({ allOk: true, ok: 2, failed: [] });
  });

  it("names the targets that failed, not just how many", () => {
    expect(bulkOutcome(["alpha", "beta", "gamma"], [ok, bad("boom"), bad("nope")])).toEqual({
      allOk: false,
      ok: 1,
      failed: ["beta", "gamma"],
    });
  });

  it("pairs labels to results by position, which allSettled preserves", () => {
    expect(bulkOutcome(["alpha", "beta"], [bad("boom"), ok]).failed).toEqual(["alpha"]);
  });

  it("stays honest when a label is missing rather than reporting a blank target", () => {
    expect(bulkOutcome([], [bad("boom")]).failed).toEqual(["0"]);
  });

  it("is clean on an empty batch, so a no-op cannot report a failure", () => {
    expect(bulkOutcome([], [])).toEqual({ allOk: true, ok: 0, failed: [] });
  });
});

describe("failedList", () => {
  const names = (n: number) => Array.from({ length: n }, (_, i) => `a${i}`);

  it("names them all while the list is short enough to read", () => {
    expect(failedList(names(8), ", ")).toBe("a0, a1, a2, a3, a4, a5, a6, a7");
  });

  it("reports the overflow as a count rather than dropping it silently", () => {
    // A batch of twenty must not turn a six-second toast into a wall of text, but the reader
    // still has to know the names shown are not the whole of it.
    expect(failedList(names(11), ", ")).toBe("a0, a1, a2, a3, a4, a5, a6, a7, +3");
  });
});

describe("firstFailure", () => {
  it("surfaces the first rejection, for the error text beside the named targets", () => {
    expect(
      firstFailure([
        { status: "fulfilled", value: 1 },
        { status: "rejected", reason: "first" },
        { status: "rejected", reason: "second" },
      ]),
    ).toBe("first");
  });

  it("is undefined when nothing failed", () => {
    expect(firstFailure([{ status: "fulfilled", value: 1 }])).toBeUndefined();
  });
});
