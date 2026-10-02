/**
 * The shared page notice (the UI package's `TodoNotice`, todo-notice.tsx) and the decisions
 * behind its bulk-update button (lib/bulk-update.ts).
 *
 * Guard, over every `<TodoNotice>` call site in the source roots (discovered, not listed):
 * - The notice is defined in one place.
 * - A bulk action is never offered without a label, nor a label without an action.
 * - The bulk button never writes on click: its handler opens the batch's own confirmation by
 *   setting the state that ConfirmModal is rendered behind.
 *
 * Behaviour:
 * - The count comes off the raised to-do, so the block never claims more than the dot was
 *   raised for.
 * - A batch outcome is clean when every target took the write (an empty batch included), and
 *   otherwise names the failed targets by position, never as a blank; a long list reports its
 *   overflow as a count; the first rejection is surfaced for the error text.
 */
import { describe, expect, it } from "vitest";
import ts from "typescript";
import { bulkOutcome, failedList, firstFailure, noticeCounts } from "../src/lib/bulk-update";
import type { Todo } from "../src/lib/todo-badges";
import { expectEveryRootScanned, expectSingleHome, scanSources } from "./helpers/roots";

/** Web and the shared UI package: the notice's call sites are counted wherever they live. */
const SCAN = scanSources();
const TODO_NOTICE = "packages/ui/src/components/feedback/todo-notice/todo-notice.tsx";

/** Every `<TodoNotice …>` in the scanned roots, as its file's repo-relative id plus its attributes by name. */
function noticeSites(): { file: string; attrs: Map<string, string>; source: string }[] {
  const sites: { file: string; attrs: Map<string, string>; source: string }[] = [];
  for (const file of SCAN.files.filter((f) => f.name.endsWith(".tsx"))) {
    const rel = file.id;
    const source = file.text;
    const sf = ts.createSourceFile(
      file.path,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
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
  // The component's own definition is not a call site, wherever it lives.
  return sites.filter((s) => !s.file.endsWith("/todo-notice.tsx"));
}

describe("the notice block is the one shape on every page that has one", () => {
  const sites = noticeSites();

  it("is looked for in every source root, and defined in one place", () => {
    expectEveryRootScanned(SCAN);
    expectSingleHome(SCAN, TODO_NOTICE);
  });

  it("never offers a bulk action without labelling it, or a label without an action", () => {
    for (const { file, attrs } of sites) {
      expect(attrs.has("actionLabel"), `${file} action label and handler must agree`).toBe(
        attrs.has("onAction"),
      );
    }
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
    // button sets is the state the dialog is rendered behind — a ConfirmModal, or a component
    // named for the confirmation it wraps (the models page's AddNewModelsConfirm).
    for (const { file, attrs, source } of withAction) {
      const setter = /\bset([A-Z]\w*)\s*\(/.exec(attrs.get("onAction") ?? "");
      expect(
        setter,
        `${file}'s onAction must open the confirmation by setting state`,
      ).not.toBeNull();
      const state = setter![1]!.charAt(0).toLowerCase() + setter![1]!.slice(1);
      const guarded = new RegExp(
        `${state}[^\\n]*&&[\\s\\S]{0,400}?<(?:ConfirmModal|\\w+Confirm)\\b`,
      );
      expect(
        guarded.test(source),
        `${file} must render its batch ConfirmModal behind ${state}`,
      ).toBe(true);
    }
  });
});

describe("noticeCounts", () => {
  it("reports the raised to-do's own count, so the block never claims more than the dot", () => {
    const todo: Todo = { signature: "a,b,c", items: ["a", "b", "c"], count: 3, match: "set" };
    expect(noticeCounts(todo)).toEqual({ updated: 3 });
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
