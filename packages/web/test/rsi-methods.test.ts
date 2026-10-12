/**
 * The Optimize tab's Method select is built from the plugin library it reads when the dialog
 * opens (src/features/benchmark/rsi-methods.ts), so what it offers follows what is installed.
 *
 * - Given the library's `rsi` group, when the options are built, then the default toolkit comes
 *   first wherever the library lists it, and every other toolkit keeps the library's order; a
 *   library without that group offers nothing.
 * - Given the default toolkit, then it runs the default loop's form with its optimizer Skill.
 * - Given any other toolkit, then it runs the Skill named like its plugin, else the first Skill
 *   its quick start preselects that it ships, else its only Skill; and a toolkit none of these
 *   settles — several Skills and nothing to choose between them, or none — is not offered.
 * - Given a toolkit's manifest, then its label is its display name in the reader's language,
 *   else its name, and its hint the short description before the full one, Chinese first in zh.
 * - Given the options, when the dialog keeps a pick, then the picked toolkit is used while it is
 *   offered, the first option once it is gone, and nothing when there is no option.
 * - Given the toolkits this repository ships, then every one is offered, the default first, each
 *   running a Skill its own plugin ships, and the evaluator the default loop measures through
 *   ships in the library too.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { PluginItem } from "@prismshadow/penguin-server/api";
import {
  DEFAULT_TOOLKIT_PLUGIN,
  EVALUATION_SKILL,
  OPTIMIZATION_SKILL,
  RSI_CATEGORY,
  pickRsiMethod,
  rsiMethods,
  rsiToolkits,
} from "../src/features/benchmark/rsi-methods";
import { REPO_ROOT } from "./helpers/roots";

/** A library plugin with the fields the mapping reads; everything else empty. */
function toolkit(name: string, over: Partial<PluginItem> = {}, skills: string[] = []): PluginItem {
  return {
    name,
    description: "",
    version: "0.0.0",
    package: `@penguinharness/${name}`,
    source: "builtin",
    skills: skills.map((skill) => ({ name: skill, description: "", version: "" })),
    hooks: [],
    mcpServers: [],
    ...over,
  };
}

const library = (plugins: PluginItem[]) => ({
  groups: [
    { id: "office-productivity", title: "Office", plugins: [toolkit("goal", {}, ["goal"])] },
    { id: RSI_CATEGORY, title: "Agent Self-Evolution", plugins },
  ],
});

describe("Method options from the plugin library", () => {
  it("lists the default toolkit first and the rest in library order; no rsi group, no options", () => {
    const plugins = [
      toolkit("opro-rsi-toolkit", {}, ["opro-rsi-toolkit"]),
      toolkit(DEFAULT_TOOLKIT_PLUGIN, {}, [OPTIMIZATION_SKILL]),
      toolkit("ape-rsi-toolkit", {}, ["ape-rsi-toolkit"]),
    ];

    const methods = rsiMethods(rsiToolkits(library(plugins)), "en");

    expect(methods.map((m) => m.plugin)).toEqual([
      DEFAULT_TOOLKIT_PLUGIN,
      "opro-rsi-toolkit",
      "ape-rsi-toolkit",
    ]);
    expect(rsiToolkits({ groups: [library([]).groups[0]!] })).toEqual([]);
  });

  it("runs the default toolkit as the default loop with its optimizer Skill", () => {
    const [method] = rsiMethods([toolkit(DEFAULT_TOOLKIT_PLUGIN, {}, [OPTIMIZATION_SKILL])], "en");

    expect(method).toMatchObject({ kind: "default", skill: OPTIMIZATION_SKILL });
  });

  it("runs another toolkit's Skill named like its plugin, else its quick start's, else its only one", () => {
    const methods = rsiMethods(
      [
        toolkit("same-name", { quickStart: { prompt: "", skills: ["helper"] } }, [
          "helper",
          "same-name",
        ]),
        toolkit("quick-start", { quickStart: { prompt: "", skills: ["elsewhere", "runner"] } }, [
          "notes",
          "runner",
        ]),
        toolkit("single", {}, ["only-one"]),
      ],
      "en",
    );

    expect(methods.map((m) => [m.plugin, m.kind, m.skill])).toEqual([
      ["same-name", "paper", "same-name"],
      ["quick-start", "paper", "runner"],
      ["single", "paper", "only-one"],
    ]);
  });

  it("does not offer a toolkit whose Skill cannot be settled", () => {
    const methods = rsiMethods(
      [
        toolkit("undecided", {}, ["first", "second"]),
        toolkit("unshipped-start", { quickStart: { prompt: "", skills: ["missing"] } }, ["a", "b"]),
        toolkit("empty"),
        toolkit("fine", {}, ["fine"]),
      ],
      "en",
    );

    expect(methods.map((m) => m.plugin)).toEqual(["fine"]);
  });

  it("labels and describes a toolkit from its manifest in the reader's language", () => {
    const full = toolkit(
      "opro-rsi-toolkit",
      {
        title: "OPRO RSI Toolkit",
        titleZh: "OPRO RSI 工具包",
        description: "Long description.",
        descriptionZh: "长描述。",
        shortDescription: "Short.",
        shortDescriptionZh: "短描述。",
      },
      ["opro-rsi-toolkit"],
    );
    const english = toolkit(
      "bare-rsi-toolkit",
      { description: "Only English.", shortDescription: "" },
      ["bare-rsi-toolkit"],
    );
    const nothing = toolkit("silent-rsi-toolkit", {}, ["silent-rsi-toolkit"]);

    const read = (locale: "zh" | "en") =>
      rsiMethods([full, english, nothing], locale).map((m) => [m.label, m.hint]);

    expect(read("zh")).toEqual([
      ["OPRO RSI 工具包", "短描述。"],
      ["bare-rsi-toolkit", "Only English."],
      ["silent-rsi-toolkit", ""],
    ]);
    expect(read("en")).toEqual([
      ["OPRO RSI Toolkit", "Short."],
      ["bare-rsi-toolkit", "Only English."],
      ["silent-rsi-toolkit", ""],
    ]);
    // A Chinese full description comes before an English short one.
    const zhFull = toolkit(
      "x",
      { descriptionZh: "中文全文。", shortDescription: "English short." },
      ["x"],
    );
    expect(rsiMethods([zhFull], "zh")[0]?.hint).toBe("中文全文。");
  });

  it("keeps a pick while it is offered, falls back to the first option, and has none to give with no options", () => {
    const methods = rsiMethods(
      [
        toolkit(DEFAULT_TOOLKIT_PLUGIN, {}, [OPTIMIZATION_SKILL]),
        toolkit("awm-rsi-toolkit", {}, ["awm-rsi-toolkit"]),
      ],
      "en",
    );

    expect(pickRsiMethod(methods, "awm-rsi-toolkit")?.plugin).toBe("awm-rsi-toolkit");
    expect(pickRsiMethod(methods, "uninstalled-rsi-toolkit")?.plugin).toBe(DEFAULT_TOOLKIT_PLUGIN);
    expect(pickRsiMethod([], DEFAULT_TOOLKIT_PLUGIN)).toBeNull();
  });
});

describe("the toolkits this repository ships", () => {
  const PLUGINS = join(REPO_ROOT, "plugins");

  /** A shipped plugin as the library would list it: its manifest's fields and its Skills. */
  function shipped(name: string): { category?: string; item: PluginItem } {
    const pkg = JSON.parse(readFileSync(join(PLUGINS, name, "package.json"), "utf8")) as {
      description?: string;
      penguin?: {
        category?: string;
        title?: string;
        title_zh?: string;
        short_description?: string;
        quick_start?: { prompt?: string; skills?: string[] };
      };
    };
    const skillsDir = join(PLUGINS, name, "skills");
    const skills = existsSync(skillsDir)
      ? readdirSync(skillsDir).filter((s) => existsSync(join(skillsDir, s, "SKILL.md")))
      : [];
    const m = pkg.penguin ?? {};
    return {
      ...(m.category !== undefined ? { category: m.category } : {}),
      item: toolkit(
        name,
        {
          description: pkg.description ?? "",
          ...(m.title !== undefined ? { title: m.title } : {}),
          ...(m.title_zh !== undefined ? { titleZh: m.title_zh } : {}),
          ...(m.short_description !== undefined ? { shortDescription: m.short_description } : {}),
          ...(m.quick_start !== undefined
            ? {
                quickStart: {
                  prompt: m.quick_start.prompt ?? "",
                  ...(m.quick_start.skills !== undefined ? { skills: m.quick_start.skills } : {}),
                },
              }
            : {}),
        },
        skills,
      ),
    };
  }

  const all = readdirSync(PLUGINS, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(PLUGINS, e.name, "package.json")))
    .map((e) => shipped(e.name));

  it("offers every one, the default first, each running a Skill its own plugin ships", () => {
    const toolkits = all.filter((p) => p.category === RSI_CATEGORY).map((p) => p.item);
    expect(toolkits.length).toBeGreaterThan(0);

    const methods = rsiMethods(toolkits, "en");

    expect(methods.map((m) => m.plugin).sort()).toEqual(toolkits.map((t) => t.name).sort());
    expect(methods[0]?.plugin).toBe(DEFAULT_TOOLKIT_PLUGIN);
    for (const method of methods) {
      const plugin = toolkits.find((t) => t.name === method.plugin)!;
      expect(
        plugin.skills.map((s) => s.name),
        method.plugin,
      ).toContain(method.skill);
    }
  });

  it("ships the evaluator the default loop measures through", () => {
    const owners = all.filter((p) => p.item.skills.some((s) => s.name === EVALUATION_SKILL));
    expect(owners.length).toBeGreaterThan(0);
  });
});
