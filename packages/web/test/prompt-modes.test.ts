/**
 * The composer's switches (features/chat/prompt-modes.ts).
 *
 * - The composer offers a switch for each library plugin whose card is a composer mode and
 *   whose hook package the Agent has, in library order; a plugin with hooks but no composer
 *   mode, or one the Agent lacks, offers none.
 * - The composer-mode plugins the Agent lacks are offered for install instead, in library order;
 *   a plugin with hooks but no composer mode is never offered.
 * - A switch the Agent no longer offers is neither shown as on nor sent; with none on, a Task
 *   names no `promptHooks` at all.
 */
import { describe, expect, it } from "vitest";
import type {
  AgentPluginsInstallResponse,
  PluginItem,
  PluginLibraryResponse,
} from "@prismshadow/penguin-server/api";
import {
  offered,
  promptHooksField,
  promptModeOffers,
  promptModeSources,
  toggled,
  type PromptMode,
} from "@prismshadow/penguin-library-session/web/chat/prompt-modes";

const plugin = (name: string, fields: Partial<PluginItem> = {}): PluginItem => ({
  name,
  description: `${name} plugin`,
  version: "0.2.18",
  package: `@penguinharness/${name}`,
  source: "builtin",
  skills: [],
  hooks: ["user_prompt"],
  mcpServers: [],
  ...fields,
});

const library: PluginLibraryResponse = {
  groups: [
    {
      id: "office-productivity",
      title: "Office Productivity",
      plugins: [
        plugin("goal", { hooks: ["stop", "user_prompt"] }),
        plugin("plan", { composerMode: true, title: "Plan mode" }),
        plugin("review", { composerMode: true }),
      ],
    },
    { id: "other", title: "Other", plugins: [plugin("tone", { composerMode: true })] },
  ],
};

const installs = (...hooks: string[]): AgentPluginsInstallResponse => ({
  skills: [],
  mcpServers: [],
  hooks: hooks.map((name) => ({ name, description: "", version: "2026.11.19.1", events: [] })),
});

const mode = (name: string): PromptMode => ({ name, title: name, description: "" });

describe("the switches the composer offers", () => {
  it("are the composer-mode plugins whose hook package the Agent has, in library order", () => {
    const names = promptModeSources(library, installs("goal", "tone", "plan")).map((p) => p.name);
    expect(names).toEqual(["plan", "tone"]);
  });

  it("are none on an Agent without any such hook package", () => {
    expect(promptModeSources(library, installs("goal"))).toEqual([]);
  });
});

describe("the composer modes offered for install", () => {
  it("are the composer-mode plugins the Agent lacks, in library order", () => {
    const names = promptModeOffers(library, installs("goal", "tone")).map((p) => p.name);
    expect(names).toEqual(["plan", "review"]);
  });

  it("are none once the Agent has every composer mode", () => {
    expect(promptModeOffers(library, installs("plan", "review", "tone"))).toEqual([]);
  });
});

describe("the switches a Task names", () => {
  it("leave out a switch the Agent no longer offers", () => {
    const on = toggled(toggled([], "plan"), "review");
    expect(on).toEqual(["plan", "review"]);
    expect(offered(on, [mode("plan")])).toEqual(["plan"]);
    expect(promptHooksField(offered(on, [mode("plan")]))).toEqual({ promptHooks: ["plan"] });
  });

  it("are no field at all once every switch is off", () => {
    expect(promptHooksField(toggled(["plan"], "plan"))).toEqual({});
  });
});
