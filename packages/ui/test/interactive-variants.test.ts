/**
 * The interactive variants: the logic they run on (modules/interaction.ts), and their first render,
 * which is what `/embed` and the screenshots take — every variant renders in both languages, and
 * an interactive one draws its open layers at rest rather than replaying how they opened.
 */
import { Fragment, createElement } from "react";
import { describe, expect, it } from "vitest";
import { en, zh } from "../src/fixtures";
import type { ModelFixture, PluginFixture } from "../src/fixtures";
import type { Module } from "../src/module";
import {
  attach,
  filterModels,
  filterPlugins,
  isHostAndPath,
  nextModelSort,
  slashMatches,
  sortModels,
  toggled,
} from "../src/modules/interaction";
import type { SlashEntry } from "../src/modules/interaction";
import { module as actions } from "../src/modules/actions.module";
import { module as company } from "../src/modules/company.module";
import { module as composer } from "../src/modules/composer.module";
import { module as content } from "../src/modules/content.module";
import { module as conversation } from "../src/modules/conversation.module";
import { module as createWithAi } from "../src/modules/create-with-ai.module";
import { module as dialogs } from "../src/modules/dialogs.module";
import { module as emptyStates } from "../src/modules/empty-states.module";
import { module as files } from "../src/modules/files.module";
import { module as forms } from "../src/modules/forms.module";
import { module as navigation } from "../src/modules/navigation.module";
import { module as overlays } from "../src/modules/overlays.module";
import { module as pages } from "../src/modules/pages.module";
import { module as stats } from "../src/modules/stats.module";
import { module as status } from "../src/modules/status.module";
import { module as tables } from "../src/modules/tables.module";
import { renderStatic } from "../src/testing";

const MODULES: readonly Module[] = [
  conversation,
  composer,
  navigation,
  actions,
  status,
  forms,
  overlays,
  dialogs,
  tables,
  stats,
  content,
  files,
  createWithAi,
  emptyStates,
  pages,
  company,
];

/** A variant's first render as markup. */
const first = (module: Module, key: string, lang: "en" | "zh" = "en") =>
  renderStatic(createElement(Fragment, null, module.render(key, { lang, mode: "light" })));

const entry = (name: string, kind: SlashEntry["kind"] = "command"): SlashEntry => ({
  kind,
  name,
  icon: "book",
  description: name,
});

describe("the slash menu's matches", () => {
  const entries = [
    entry("/compact"),
    entry("/clear"),
    entry("/model"),
    entry("/penguin-sdk", "skill"),
  ];

  it("open on a slash and narrow as the word is typed, ignoring case", () => {
    expect(slashMatches(entries, "/")).toHaveLength(4);
    expect(slashMatches(entries, "/C").map((e) => e.name)).toEqual(["/compact", "/clear"]);
    expect(slashMatches(entries, "/pen").map((e) => e.name)).toEqual(["/penguin-sdk"]);
  });

  it("stay shut without a leading slash, after a space, or when nothing matches", () => {
    expect(slashMatches(entries, "")).toEqual([]);
    expect(slashMatches(entries, "compact")).toEqual([]);
    expect(slashMatches(entries, "/compact ")).toEqual([]);
    expect(slashMatches(entries, "/zzz")).toEqual([]);
  });

  it("attach a chip once, however often it is attached", () => {
    const file = { kind: "file" as const, label: "src/rag.ts" };
    const skill = { kind: "skill" as const, label: "penguin-sdk" };
    expect(attach(attach([file], [file, skill]), [skill])).toEqual([file, skill]);
  });
});

describe("the models table", () => {
  const model = (id: string, output: number, name = id): ModelFixture =>
    ({
      modelId: id,
      displayName: name,
      providerLabel: "Acme",
      contextWindow: 1000,
      pricing: { cacheRead: 0, cacheWrite: 0, output },
    }) as ModelFixture;
  const rows = [model("a", 2, "Beta"), model("b", 5, "alpha"), model("c", 2, "Gamma")];

  it("sorts either way, keeping ties in the order they came", () => {
    const ids = (list: ModelFixture[]) => list.map((m) => m.modelId);
    expect(ids(sortModels(rows, { key: "output", dir: "desc" }))).toEqual(["b", "a", "c"]);
    expect(ids(sortModels(rows, { key: "output", dir: "asc" }))).toEqual(["a", "c", "b"]);
    expect(ids(sortModels(rows, { key: "model", dir: "asc" }))).toEqual(["b", "a", "c"]);
  });

  it("flips the sorted column, and starts another at names A–Z or numbers largest first", () => {
    expect(nextModelSort({ key: "output", dir: "desc" }, "output")).toEqual({
      key: "output",
      dir: "asc",
    });
    expect(nextModelSort({ key: "output", dir: "asc" }, "model")).toEqual({
      key: "model",
      dir: "asc",
    });
    expect(nextModelSort({ key: "model", dir: "asc" }, "context")).toEqual({
      key: "context",
      dir: "desc",
    });
  });

  it("narrows to the rows holding every typed word in name, id or provider", () => {
    expect(filterModels(en.models, "  ")).toHaveLength(en.models.length);
    const deepseek = filterModels(en.models, "DeepSeek flash");
    expect(deepseek.map((m) => m.modelId)).toEqual(["deepseek-v4-flash"]);
    expect(filterModels(en.models, "no such model")).toEqual([]);
  });
});

describe("the base URL field", () => {
  it("takes a host and a path, and refuses what the fixtures send as wrong", () => {
    for (const f of [en, zh]) {
      const field = f.forms.fields.find((candidate) => candidate.error !== undefined)!;
      expect(isHostAndPath(field.value)).toBe(false);
      expect(isHostAndPath(field.placeholder ?? "")).toBe(true);
    }
    expect(isHostAndPath("")).toBe(false);
    expect(isHostAndPath("localhost/api")).toBe(false);
  });
});

describe("the Plugins page's filters", () => {
  const plugins: readonly PluginFixture[] = en.plugins;

  it("narrow by search, category and kind, an empty set filtering nothing", () => {
    expect(filterPlugins(plugins, "", new Set(), new Set())).toHaveLength(plugins.length);
    const first = plugins[0]!;
    expect(filterPlugins(plugins, first.name.toUpperCase(), new Set(), new Set())).toContain(first);
    for (const plugin of filterPlugins(plugins, "", new Set([first.category]), new Set())) {
      expect(plugin.category).toBe(first.category);
    }
    for (const plugin of filterPlugins(plugins, "", new Set(), new Set([first.kind]))) {
      expect(plugin.kind).toBe(first.kind);
    }
  });

  it("toggle a row in and out of a set without touching the one it was given", () => {
    const start = new Set(["a"]);
    expect([...toggled(start, "b")]).toEqual(["a", "b"]);
    expect([...toggled(start, "a")]).toEqual([]);
    expect([...start]).toEqual(["a"]);
  });
});

describe("the variants' first render", () => {
  for (const module of MODULES) {
    for (const variant of module.variants) {
      it(`${module.id} ${variant.key} renders in both languages`, () => {
        for (const lang of ["en", "zh"] as const) {
          const html = first(module, variant.key, lang);
          expect(html.length, lang).toBeGreaterThan(0);
          if (variant.kind === "interactive") {
            // The still is the resting picture: what is open is drawn open, not arriving.
            expect(html, lang).not.toContain('data-presence="enter"');
            expect(html, lang).not.toContain('data-backdrop="enter"');
          }
        }
      });
    }
  }

  it("opens each interactive variant on what its still showed", () => {
    const html = (module: Module, key: string) => first(module, key);
    expect(html(navigation, "sidebar")).toContain(en.copy.nav.collapseSidebar);
    expect(html(overlays, "menu")).toContain('role="menuitem"');
    expect(html(overlays, "menu")).toContain('role="tooltip"');
    expect(html(dialogs, "confirm")).toContain('role="dialog"');
    expect(html(files, "tree")).toContain(en.copy.files.empty.title);
    expect(html(emptyStates, "first-session")).toContain(
      en.emptyStates.firstSession.examples[1]!.prompt,
    );
    expect(html(composer, "idle")).toContain(en.copy.chat.inputPlaceholder);
  });
});
