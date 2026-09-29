/**
 * The gallery's documentation modules: the Foundations page is the one `MODULE_IDS` names, its
 * file lists the catalog sections its Parts section shows, every section is listed by its own
 * module, every demo is reachable from some module, and a Chinese title exists for each module,
 * board and section.
 */
import { describe, expect, it } from "vitest";
import { CATALOG, catalogSection } from "../../ui/src/catalog";
import { MODULE_IDS } from "../../ui/src/module";
import type { Module, ModuleVariant } from "../../ui/src/module";
import { collectModules, PAGE_SECTION_IDS, pickVariant, VARIANT_KEY } from "../src/lib/modules";
import { DEMOS, MODULES } from "../src/registry";
import { zh } from "../src/strings";

describe("the collected modules", () => {
  it("are one file per MODULE_IDS entry, in that order, with nothing to report", () => {
    expect(MODULES.problems).toEqual([]);
    expect(MODULES.list.map(({ module }) => module.id)).toEqual([...MODULE_IDS]);
    expect(MODULE_IDS).toEqual(["foundations"]);
  });

  it("each have a title, a description and addressable boards", () => {
    for (const { module } of MODULES.list) {
      expect(module.title.trim(), module.id).not.toBe("");
      expect(module.description.trim(), module.id).not.toBe("");
      expect(module.variants.length, module.id).toBeGreaterThan(0);
      for (const variant of module.variants) {
        expect(variant.key, module.id).toMatch(VARIANT_KEY);
        expect(variant.title.trim(), `${module.id} ${variant.key}`).not.toBe("");
      }
    }
  });

  it("keep a page's addresses apart: no board or part is named like a page section or each other", () => {
    for (const { module } of MODULES.list) {
      for (const variant of module.variants) {
        expect(PAGE_SECTION_IDS as readonly string[], variant.key).not.toContain(variant.key);
        expect(module.parts, variant.key).not.toContain(variant.key);
      }
      for (const part of module.parts) {
        expect(PAGE_SECTION_IDS as readonly string[], part).not.toContain(part);
      }
    }
  });

  it("list only catalogued parts, and every section is listed by its own module", () => {
    for (const { module } of MODULES.list) {
      for (const id of module.parts)
        expect(catalogSection(id), `${module.id}: ${id}`).toBeDefined();
    }
    for (const section of CATALOG) {
      expect(MODULES.byId.get(section.module)?.module.parts, section.id).toContain(section.id);
    }
  });

  it("reach every demo through some module's parts", () => {
    expect(DEMOS.problems).toEqual([]);
    for (const id of DEMOS.byId.keys()) {
      expect(
        MODULES.list.some(({ module }) => module.parts.includes(id)),
        id,
      ).toBe(true);
    }
  });

  it("have a Chinese title, description and board titles, as does every section", () => {
    for (const { module } of MODULES.list) {
      const text = zh.catalog.modules[module.id];
      expect(text, module.id).toBeDefined();
      for (const variant of module.variants) {
        expect(text?.variants[variant.key], `${module.id} ${variant.key}`).toBeDefined();
      }
    }
    for (const section of CATALOG)
      expect(zh.catalog.sections[section.id], section.id).toBeDefined();
  });
});

describe("the catalog", () => {
  it("gives every section a unique kebab-case id, at least one export and a module", () => {
    const ids = CATALOG.map((section) => section.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const section of CATALOG) {
      expect(section.id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(section.components.length, section.id).toBeGreaterThan(0);
      expect(MODULE_IDS as readonly string[]).toContain(section.module);
    }
  });
});

describe("collectModules", () => {
  const catalog = [{ id: "icons-glyph-icon" }];
  const make = (id: string, extra: Partial<Module> = {}): Module =>
    ({
      id,
      title: id,
      description: "",
      variants: [{ key: "colour", title: "Colour" }],
      parts: [],
      render: () => null,
      ...extra,
    }) as Module;

  it("reports, and skips, what cannot be rendered as a module", () => {
    const registry = collectModules(
      {
        "m/a.module.tsx": {},
        "m/nope.module.tsx": { module: make("nope") },
      },
      catalog,
    );
    const text = registry.problems.join("\n");
    expect(text).toMatch(/m\/a\.module\.tsx: no `module` export/);
    expect(text).toMatch(/"nope" is not in MODULE_IDS/);
    // Nothing attempted to define Foundations, so its absence is named.
    expect(text).toMatch(/module "foundations" has no foundations\.module\.tsx/);
    expect(registry.list).toEqual([]);
    // A file that attempts the id under the wrong name is reported for the name, once.
    const misnamed = collectModules(
      { "m/wrong-name.module.tsx": { module: make("foundations") } },
      catalog,
    );
    expect(misnamed.problems).toEqual([
      'm/wrong-name.module.tsx: module "foundations" must live in foundations.module.tsx',
    ]);
    expect(misnamed.list).toEqual([]);
  });

  it("reports bad keys and unknown parts, keeping a module whose parts are merely unknown", () => {
    const variants: ModuleVariant[] = [
      { key: "colour", title: "Colour" },
      { key: "colour", title: "Again" },
      { key: "Type.v", title: "Type" },
    ];
    const bad = collectModules(
      { "m/foundations.module.tsx": { module: make("foundations", { variants }) } },
      catalog,
    );
    expect(bad.problems.join("\n")).toMatch(
      /variant keys must be unique lowercase words joined by "-": colour, Type\.v/,
    );
    expect(bad.list).toEqual([]);
    const parts = collectModules(
      {
        "m/foundations.module.tsx": {
          module: make("foundations", {
            parts: ["icons-glyph-icon", "nope-part"],
            variants: [{ key: "parts", title: "P" }],
          }),
        },
      },
      catalog,
    );
    expect(parts.problems.join("\n")).toMatch(/parts not in catalog\.ts: nope-part/);
    expect(parts.problems.join("\n")).toMatch(/variant "parts" takes a page section's address/);
    expect(parts.list.map(({ module }) => module.id)).toEqual(["foundations"]);
  });

  it("reads an unknown pick as the default board", () => {
    const module = make("foundations", {
      variants: [
        { key: "colour", title: "Colour" },
        { key: "type", title: "Type" },
      ],
    });
    expect(pickVariant(module, "type").key).toBe("type");
    expect(pickVariant(module, "gone").key).toBe("colour");
    expect(pickVariant(module, undefined).key).toBe("colour");
  });
});
