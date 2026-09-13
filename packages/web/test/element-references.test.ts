/**
 * The send-time seam for element chips (features/workbench/element-references.ts, M4.1 / AC-8).
 *
 * The rule this file pins down is the one a user feels as "the Agent fixed the right line": a chip
 * staged from a page that has since been edited must be re-resolved before it goes out, a chip whose
 * element the page no longer has must be *reported* rather than sent, and a chip nobody can check
 * must keep exactly what it was staged with — claiming a freshness that was never measured is the
 * failure mode this whole milestone exists to prevent. A source here is a plain function, so every
 * one of those branches is a test rather than a browser session.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  refreshElementReference,
  refreshElementReferences,
  registerElementSource,
} from "../src/features/workbench/element-references";
import type { ElementRefresh, ElementSource } from "../src/features/workbench/element-references";
import type { ComposerReference } from "../src/lib/workspace-tree";

const element = (refId?: string, label?: string): ComposerReference => ({
  kind: "element",
  label: label ?? "h2.card-title",
  text: "element payload",
  ...(refId === undefined ? {} : { refId }),
});

const refreshed = (refId: string, label = "h2.card-title"): ElementRefresh => ({
  kind: "refreshed",
  reference: { kind: "element", label, text: "fresh payload", refId },
  moved: false,
});

/** Every source registered by a test is unregistered at the end of it: the set is module-level. */
const unregisters: (() => void)[] = [];
const source = (refresh: ElementSource["refresh"]): void => {
  unregisters.push(registerElementSource({ refresh: refresh }));
};
afterEach(() => {
  while (unregisters.length > 0) unregisters.pop()?.();
});

describe("registerElementSource", () => {
  it("answers through a registered source and stops answering once it unregisters", async () => {
    const unregister = registerElementSource({ refresh: async () => refreshed("el-1") });
    expect(await refreshElementReference("el-1")).toMatchObject({ kind: "refreshed" });
    unregister();
    expect(await refreshElementReference("el-1")).toEqual({ kind: "unknown" });
  });

  it("takes the first source that can answer, not the last one registered", async () => {
    const first = vi.fn(async (): Promise<ElementRefresh> => refreshed("el-1", "first"));
    const second = vi.fn(async (): Promise<ElementRefresh> => refreshed("el-1", "second"));
    source(first);
    source(second);
    // A source answers `unknown` for a chip that is not its own — that is how two panels coexist —
    // and here the first one owns it, so the second is never even asked.
    const result = await refreshElementReference("el-1");
    expect(result).toMatchObject({ kind: "refreshed", reference: { label: "first" } });
    expect(second).not.toHaveBeenCalled();
  });

  it("falls through to the next source when one does not own the chip", async () => {
    source(async () => ({ kind: "unknown" }));
    const owner = vi.fn(async (): Promise<ElementRefresh> => refreshed("el-9"));
    source(owner);
    expect(await refreshElementReference("el-9")).toMatchObject({ kind: "refreshed" });
    expect(owner).toHaveBeenCalledWith("el-9");
  });

  it("survives a source that throws, and lets a later source answer", async () => {
    source(async () => {
      throw new Error("the guest went away mid-call");
    });
    source(async () => refreshed("el-2"));
    // The throw is one source's problem, not the user's: the chip still gets an answer.
    expect(await refreshElementReference("el-2")).toMatchObject({ kind: "refreshed" });
  });

  it("reports unknown when no source is registered at all", async () => {
    expect(await refreshElementReference("el-3")).toEqual({ kind: "unknown" });
  });
});

describe("refreshElementReferences", () => {
  it("leaves file, directory and quote chips exactly as they were", async () => {
    const files: ComposerReference[] = [
      { kind: "file", path: "src/App.tsx", text: "f" },
      { kind: "dir", path: "src/", text: "d" },
      { kind: "quote", path: "src/App.tsx", text: "q", fromLine: 3, toLine: 5 },
    ];
    const result = await refreshElementReferences(files);
    expect(result.references).toEqual(files);
    expect(result).toMatchObject({ gone: [], refreshed: 0, unchecked: 0 });
  });

  it("leaves an element chip with no refId alone, and does not count it as checked", async () => {
    const stray = element();
    const result = await refreshElementReferences([stray]);
    // There is nothing to look it up by: inventing an answer is not on the table.
    expect(result.references).toEqual([stray]);
    expect(result).toMatchObject({ gone: [], refreshed: 0, unchecked: 0 });
  });

  it("keeps an unchecked chip's snapshot and counts it as unchecked", async () => {
    const chip = element("el-4");
    source(async () => ({ kind: "unknown" }));
    const result = await refreshElementReferences([chip]);
    expect(result.references).toEqual([chip]);
    expect(result).toMatchObject({ refreshed: 0, unchecked: 1, gone: [] });
  });

  it("keeps a gone chip, marks it stale, and reports why", async () => {
    source(async () => ({ kind: "gone", reason: "missing" }));
    const result = await refreshElementReferences([element("el-5", "button.save")]);
    expect(result.references).toEqual([{ ...element("el-5", "button.save"), stale: true }]);
    expect(result.gone).toEqual([{ label: "button.save", reason: "missing" }]);
    expect(result.refreshed).toBe(0);
  });

  it("names a gone chip by its refId when it has no label", async () => {
    source(async () => ({ kind: "gone", reason: "page-changed" }));
    const result = await refreshElementReferences([
      { kind: "element", text: "payload", refId: "el-6" },
    ]);
    expect(result.gone).toEqual([{ label: "el-6", reason: "page-changed" }]);
  });

  it("replaces a refreshed chip with the freshly resolved one, in place and in order", async () => {
    // The order of the draft is the order of the message, and a refresh must not shuffle it.
    const before: ComposerReference[] = [
      { kind: "file", path: "src/App.tsx", text: "f" },
      element("el-7", "old label"),
      { kind: "quote", path: "src/App.tsx", text: "q", fromLine: 1, toLine: 2 },
    ];
    source(async (refId) =>
      refId === "el-7" ? refreshed("el-8", "h2.card-title") : { kind: "unknown" },
    );
    const result = await refreshElementReferences(before);
    expect(result.references).toEqual([
      before[0],
      { kind: "element", label: "h2.card-title", text: "fresh payload", refId: "el-8" },
      before[2],
    ]);
    expect(result).toMatchObject({ refreshed: 1, unchecked: 0, gone: [] });
  });

  it("resolves a mixed draft one chip at a time and reports each outcome", async () => {
    source(async (refId) => {
      if (refId === "el-live") return refreshed("el-live", "live");
      if (refId === "el-dead") return { kind: "gone", reason: "replaced" };
      return { kind: "unknown" };
    });
    const result = await refreshElementReferences([
      element("el-live"),
      element("el-dead", "div.card"),
      element("el-blind", "span.tip"),
    ]);
    expect(result.refreshed).toBe(1);
    expect(result.gone).toEqual([{ label: "div.card", reason: "replaced" }]);
    expect(result.unchecked).toBe(1);
    expect(result.references.map((reference) => reference.refId)).toEqual([
      "el-live",
      "el-dead",
      "el-blind",
    ]);
    expect(result.references.map((reference) => reference.stale)).toEqual([
      undefined,
      true,
      undefined,
    ]);
  });

  it("returns an empty draft unchanged", async () => {
    expect(await refreshElementReferences([])).toEqual({
      references: [],
      gone: [],
      refreshed: 0,
      unchecked: 0,
    });
  });
});
