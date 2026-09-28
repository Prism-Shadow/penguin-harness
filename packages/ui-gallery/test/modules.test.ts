/**
 * The gallery is the modules `MODULE_IDS` names: one file per entry, each listing the catalog
 * sections its Parts drawer shows, every section listed by its own module, every demo reachable
 * from some module, a scene on every product module's default variant with addressable frames,
 * and a Chinese title for each module, variant, frame and section.
 */
import { describe, expect, it } from "vitest";
import { CATALOG, catalogSection } from "../../ui/src/catalog";
import { APP_COLUMN_WIDTH, APP_WINDOW_WIDTH, MODULE_IDS } from "../../ui/src/module";
import type { Module } from "../../ui/src/module";
import { collectModules, pickVariant, storedVariantKey, VARIANT_KEY } from "../src/lib/modules";
import { DEMOS, MODULES } from "../src/registry";
import { zh } from "../src/strings";

/**
 * The gallery's own two modules render gallery machinery — the Foundations boards and the
 * Screens thumbnails, which are frames of other routes — and have nothing to animate; every
 * product module's default variant plays.
 */
const GALLERY_OWN = new Set<string>(["foundations", "screens"]);

describe("the collected modules", () => {
  it("are one file per MODULE_IDS entry, in that order, with nothing to report", () => {
    expect(MODULES.problems).toEqual([]);
    expect(MODULES.list.map(({ module }) => module.id)).toEqual([...MODULE_IDS]);
  });

  it("each have a title, a description, a width and addressable variants", () => {
    for (const { module } of MODULES.list) {
      expect(module.title.trim(), module.id).not.toBe("");
      expect(module.description.trim(), module.id).not.toBe("");
      expect(["narrow", "wide"], module.id).toContain(module.width);
      expect(module.variants.length, module.id).toBeGreaterThan(0);
      for (const variant of module.variants) {
        expect(variant.key, module.id).toMatch(VARIANT_KEY);
        expect(variant.title.trim(), `${module.id} ${variant.key}`).not.toBe("");
      }
    }
  });

  it("play: every product module's default variant carries a scene, and no variant is a live-* twin", () => {
    for (const { module } of MODULES.list) {
      if (GALLERY_OWN.has(module.id)) continue;
      expect(
        module.variants[0]?.scene,
        `${module.id}: the default variant has a scene`,
      ).toBeDefined();
      for (const variant of module.variants) {
        // Round 1's separate live variants folded onto the static ones they end in.
        expect(variant.key, `${module.id} ${variant.key}`).not.toMatch(/^live-/);
      }
    }
  });

  it("give every scene two or more addressable frames", () => {
    for (const { module } of MODULES.list) {
      for (const variant of module.variants) {
        const keys = variant.scene?.frames.map((frame) => frame.key);
        if (keys === undefined) continue;
        expect(keys.length, `${module.id} ${variant.key}`).toBeGreaterThanOrEqual(2);
        expect(new Set(keys).size, `${module.id} ${variant.key}`).toBe(keys.length);
        for (const key of keys) expect(key, `${module.id} ${variant.key}`).toMatch(VARIANT_KEY);
      }
    }
  });

  it("lay app regions out at the app's widths, and leave narrow ones to their own", () => {
    const widths = new Set<number>([APP_WINDOW_WIDTH, APP_COLUMN_WIDTH]);
    for (const { module } of MODULES.list) {
      if (module.viewport === undefined) continue;
      expect(module.width, `${module.id}: a narrow composition keeps its own width`).toBe("wide");
      expect(widths.has(module.viewport), `${module.id}: ${module.viewport}`).toBe(true);
    }
    // The app windows, whose sidebar alone would take half a card laid out at the card's width.
    expect(MODULES.byId.get("navigation")?.module.viewport).toBe(APP_WINDOW_WIDTH);
    expect(MODULES.byId.get("hero")?.module.viewport).toBe(APP_WINDOW_WIDTH);
  });

  it("open on the hero, then Foundations, and close on Screens, the sum", () => {
    expect(MODULE_IDS[0]).toBe("hero");
    expect(MODULE_IDS[1]).toBe("foundations");
    expect(MODULE_IDS[MODULE_IDS.length - 1]).toBe("screens");
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

  it("never share an address with a part: module ids have no `-`, part ids always do", () => {
    // `create-with-ai` and `empty-states` are the exceptions the picks' `v.<id>` form allows:
    // a module id is still never a part id, since every part id names its module first.
    for (const id of MODULE_IDS) expect(id).toMatch(/^[a-z]+(?:-[a-z]+)*$/);
    for (const section of CATALOG) {
      expect(section.id).toContain("-");
      expect(MODULE_IDS as readonly string[], section.id).not.toContain(section.id);
    }
  });

  it("have a Chinese title, description and variant titles, as does every section", () => {
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

  it("have a Chinese title for every frame of every scene, and for nothing else", () => {
    for (const { module } of MODULES.list) {
      const frames: Record<string, string[]> = {};
      for (const variant of module.variants) {
        if (variant.scene) frames[variant.key] = variant.scene.frames.map((f) => f.key).sort();
      }
      const translated: Record<string, string[]> = {};
      for (const [key, titles] of Object.entries(zh.catalog.modules[module.id]?.frames ?? {})) {
        translated[key] = Object.keys(titles).sort();
      }
      expect(translated, module.id).toEqual(frames);
    }
  });
});

describe("the catalog", () => {
  it("gives every section a unique kebab-case id and at least one export", () => {
    const ids = CATALOG.map((section) => section.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const section of CATALOG) {
      expect(section.id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(section.components.length, section.id).toBeGreaterThan(0);
    }
  });

  it("files every section under a module, grouped in module order", () => {
    const order = CATALOG.map((section) => MODULE_IDS.indexOf(section.module));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
});

describe("collectModules", () => {
  const catalog = [{ id: "actions-button" }];
  const make = (id: string, extra: Partial<Module> = {}): Module =>
    ({
      id,
      title: id,
      description: "",
      width: "wide",
      variants: [{ key: "default", title: "Default" }],
      parts: [],
      render: () => null,
      ...extra,
    }) as Module;

  it("reports, and skips, what cannot be rendered as a module", () => {
    const oneFrame = { key: "queued", title: "Queued", hold: 1000 };
    const registry = collectModules(
      {
        "m/a.module.tsx": {},
        "m/nope.module.tsx": { module: make("nope") },
        "m/wrong-name.module.tsx": { module: make("status") },
        "m/forms.module.tsx": { module: make("forms", { variants: [] }) },
        "m/tables.module.tsx": {
          module: make("tables", {
            variants: [
              { key: "band", title: "Band" },
              { key: "band", title: "Again" },
              { key: "Plain.v", title: "Plain" },
            ],
          }),
        },
        "m/actions.module.tsx": {
          module: make("actions", { parts: ["actions-button", "nope-part"] }),
        },
        "m/files.module.tsx": {
          module: make("files", {
            variants: [
              {
                key: "tree",
                title: "Tree",
                scene: {
                  frames: [
                    { key: "closed", title: "Closed", hold: 1000 },
                    { key: "Open", title: "Open", hold: 0 },
                  ],
                },
              },
            ],
          }),
        },
        "m/status.module.tsx": {
          module: make("status", {
            variants: [{ key: "live", title: "Live", scene: { frames: [oneFrame] } }],
          }),
        },
        "m/stats.module.tsx": { module: make("stats", { viewport: 0 }) },
        "x/actions.module.tsx": { module: make("actions") },
      },
      catalog,
    );
    const text = registry.problems.join("\n");
    expect(text).toMatch(/m\/a\.module\.tsx: no `module` export/);
    expect(text).toMatch(/"nope" is not in MODULE_IDS/);
    expect(text).toMatch(/module "status" must live in status\.module\.tsx/);
    expect(text).toMatch(/module "forms" has no variants/);
    expect(text).toMatch(
      /variant keys must be unique lowercase words joined by "-": band, Plain\.v/,
    );
    expect(text).toMatch(/parts not in catalog\.ts: nope-part/);
    expect(text).toMatch(/module "actions" is already defined by m\/actions\.module\.tsx/);
    expect(text).toMatch(/module "conversation" has no conversation\.module\.tsx/);
    expect(text).toMatch(/frame keys of "tree" must be unique lowercase words .*: Open/);
    expect(text).toMatch(/frame holds of "tree" must be positive ms: Open/);
    expect(text).toMatch(/scene of "live" needs at least two frames/);
    expect(text).toMatch(/viewport of "stats" must be a positive width in px/);
    // A module with an unknown part, or a width it cannot be laid out at, still renders.
    expect(registry.list.map(({ module }) => module.id)).toEqual(["actions", "stats"]);
  });

  it("reads an unknown pick as the default variant, and stores the default as no pick", () => {
    const module = make("status", {
      variants: [
        { key: "live", title: "Live" },
        { key: "notices", title: "Notices" },
      ],
    });
    expect(pickVariant(module, "notices").key).toBe("notices");
    expect(pickVariant(module, "gone").key).toBe("live");
    expect(pickVariant(module, undefined).key).toBe("live");
    expect(storedVariantKey(module, "live")).toBeNull();
    expect(storedVariantKey(module, "notices")).toBe("notices");
  });
});
