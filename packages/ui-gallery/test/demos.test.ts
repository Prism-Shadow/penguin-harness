import { describe, expect, it } from "vitest";
import { defineDemo } from "../../ui/src/demo";
import type { Demo } from "../../ui/src/demo";
import {
  allSelections,
  collectDemos,
  defaultPick,
  formatVariantKey,
  MATRIX_KEY,
  parseVariantKey,
  pickLabels,
} from "../src/lib/demos";

const axes = { variant: ["primary", "danger"], size: ["sm", "md", "icon-sm"] } as const;

describe("variant keys", () => {
  it("opens a matrix demo on the matrix and any other demo on each axis's first value", () => {
    expect(defaultPick(axes, true)).toEqual({ kind: "matrix" });
    expect(defaultPick(axes, false)).toEqual({
      kind: "single",
      selection: { variant: "primary", size: "sm" },
    });
    expect(defaultPick(undefined, true)).toEqual({ kind: "single", selection: {} });
  });

  it("round-trips a selection through its key", () => {
    const pick = parseVariantKey(axes, true, "danger.icon-sm");
    expect(pick).toEqual({ kind: "single", selection: { variant: "danger", size: "icon-sm" } });
    expect(formatVariantKey(axes, pick)).toBe("danger.icon-sm");
    expect(pickLabels(axes, pick)).toEqual(["danger", "icon-sm"]);
  });

  it("reads `all` as the matrix only for a matrix demo", () => {
    expect(parseVariantKey(axes, true, MATRIX_KEY)).toEqual({ kind: "matrix" });
    expect(parseVariantKey(axes, false, MATRIX_KEY)).toEqual(defaultPick(axes, false));
    expect(pickLabels(axes, { kind: "matrix" })).toEqual(["all"]);
  });

  it("reads a stale or malformed key as the default pick", () => {
    for (const key of ["danger", "danger.xl", "danger.sm.extra", ""]) {
      expect(parseVariantKey(axes, false, key)).toEqual(defaultPick(axes, false));
    }
  });

  it("lists every combination in declaration order", () => {
    const rows = allSelections(axes);
    expect(rows).toHaveLength(6);
    expect(rows[0]).toEqual({ variant: "primary", size: "sm" });
    expect(rows[5]).toEqual({ variant: "danger", size: "icon-sm" });
    expect(allSelections(undefined)).toEqual([{}]);
  });
});

describe("collectDemos", () => {
  const sections = [{ id: "actions-button" }, { id: "feedback-badge" }];
  const demo = (id: string, extra: Partial<Demo> = {}): Demo =>
    ({ id, title: id, description: "", render: () => null, ...extra }) as Demo;

  it("indexes a catalogued demo and types its selection from the axes", () => {
    const button = defineDemo({
      id: "actions-button",
      title: "Button",
      description: "",
      axes: { size: ["sm", "md"] },
      render: ({ size }) => size,
    });
    const registry = collectDemos({ "a/button.demo.tsx": { demo: button } }, sections);
    expect(registry.byId.get("actions-button")?.path).toBe("a/button.demo.tsx");
    expect(registry.problems).toEqual([]);
  });

  it("reports a demo no catalog section names, since no module would list it", () => {
    const registry = collectDemos({ "x.demo.tsx": { demo: demo("forms-new-thing") } }, sections);
    expect(registry.byId.size).toBe(0);
    expect(registry.problems).toEqual([
      'x.demo.tsx: "forms-new-thing" is not a catalog.ts section, so no module lists it',
    ]);
  });

  it("reports, and skips, what cannot be rendered as a part", () => {
    const registry = collectDemos(
      {
        "a.demo.tsx": {},
        "b.demo.tsx": { demo: demo("actions-button") },
        "c.demo.tsx": { demo: demo("actions-button") },
        "e.demo.tsx": { demo: demo("feedback-badge", { axes: { size: ["Large", "a.b"] } }) },
        "f.demo.tsx": { demo: demo("feedback-badge", { axes: { size: [] } }) },
      },
      sections,
    );
    expect(registry.byId.get("actions-button")?.path).toBe("b.demo.tsx");
    expect(registry.problems).toHaveLength(4);
    const text = registry.problems.join("\n");
    expect(text).toMatch(/a\.demo\.tsx: no `demo` export/);
    expect(text).toMatch(/c\.demo\.tsx: demo id "actions-button" is already used by b\.demo\.tsx/);
    expect(text).toMatch(/size=Large, size=a\.b/);
    expect(text).toMatch(/size \(empty\)/);
  });

  it("reports an axis value that collides with the matrix's own key", () => {
    const registry = collectDemos(
      { "g.demo.tsx": { demo: demo("actions-button", { axes: { scope: [MATRIX_KEY, "mine"] } }) } },
      sections,
    );
    expect(registry.byId.size).toBe(0);
    expect(registry.problems[0]).toMatch(/scope=all/);
  });
});
