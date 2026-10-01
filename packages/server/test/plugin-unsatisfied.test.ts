import { describe, expect, it } from "vitest";
import {
  ModuleBootError,
  type ModuleDef,
  type ModuleTree,
  type Problem,
} from "@prismshadow/penguin-core/kernel";
import type { LoadedPlugin } from "../src/plugin/host.js";
import { bootWithoutUnsatisfied, pluginsBehind } from "../src/plugin/unsatisfied.js";

const def = (name: string) => ({ manifest: { name } }) as unknown as ModuleDef;
const plugin = (specifier: string, ...names: string[]): LoadedPlugin => ({
  specifier,
  modules: names.map(def),
  replaces: [],
});
const noSlot = (path: string): Problem => ({
  path,
  kind: "no-such-slot",
  slotKey: "WebModule.quickStarts",
});
const tree = {} as ModuleTree;

describe("pluginsBehind", () => {
  const plugins = [
    plugin("@x/claude-code", "ClaudeCode", "ClaudeCodeQueueModule"),
    plugin("@x/lang", "Languages"),
  ];

  it("names the plugin whose module a problem's path runs through", () => {
    expect(
      pluginsBehind(
        [noSlot("/PlatformModule/ClaudeCode"), noSlot("/PlatformModule/ClaudeCodeQueueModule")],
        plugins,
      ),
    ).toEqual(new Set(["@x/claude-code"]));
  });

  it("names the plugin a platform module failed to wire to", () => {
    const p: Problem = {
      path: "/PlatformModule/WebModule",
      kind: "unresolved",
      alias: "l",
      from: "Languages",
      why: "",
    };
    expect(pluginsBehind([p], plugins)).toEqual(new Set(["@x/lang"]));
  });

  it("is null when any problem is the platform's own", () => {
    expect(
      pluginsBehind(
        [noSlot("/PlatformModule/ClaudeCode"), noSlot("/PlatformModule/WebModule")],
        plugins,
      ),
    ).toBeNull();
  });
});

describe("bootWithoutUnsatisfied", () => {
  const contributing = (specifier: string, name: string, slotKey: string): LoadedPlugin => ({
    specifier,
    modules: [
      {
        manifest: { name, contributes: { [slotKey]: [{ id: `${name}.x` }], "Kept.slot": [] } },
      } as unknown as ModuleDef,
    ],
    replaces: [],
  });
  const unresolved = (path: string, from: string): Problem => ({
    path,
    kind: "unresolved",
    alias: "a",
    from,
    why: "provides nothing",
  });

  it("drops a contribution to a slot this platform lacks and keeps the plugin", async () => {
    const plugins = [contributing("@x/proposals", "Proposals", "WebModule.quickStarts")];
    const seen: string[][] = [];
    const { tree: booted, left } = await bootWithoutUnsatisfied(plugins, async ({ modules }) => {
      const slots = Object.keys(modules[0]!.manifest.contributes);
      seen.push(slots);
      if (slots.includes("WebModule.quickStarts")) {
        throw new ModuleBootError("module tree rejected", [noSlot("/PlatformModule/Proposals")]);
      }
      return tree;
    });
    expect(booted).toBe(tree);
    expect(seen).toEqual([["WebModule.quickStarts", "Kept.slot"], ["Kept.slot"]]);
    expect(left.size).toBe(0);
  });

  it("leaves out a plugin a wiring problem is traced to, and says which", async () => {
    const plugins = [plugin("@x/claude-code", "ClaudeCode"), plugin("@x/lang", "Languages")];
    const seen: string[][] = [];
    const { tree: booted, left } = await bootWithoutUnsatisfied(plugins, async ({ modules }) => {
      const names = modules.map((m) => m.manifest.name);
      seen.push(names);
      if (names.includes("ClaudeCode")) {
        throw new ModuleBootError("module tree rejected", [
          unresolved("/PlatformModule/ClaudeCode", "SessionSurfacesModule"),
        ]);
      }
      return tree;
    });
    expect(booted).toBe(tree);
    expect(seen).toEqual([["ClaudeCode", "Languages"], ["Languages"]]);
    expect([...left.keys()]).toEqual(["@x/claude-code"]);
  });

  it("rethrows a rejection that is not a plugin's, and any other error", async () => {
    const plugins = [plugin("@x/lang", "Languages")];
    await expect(
      bootWithoutUnsatisfied(plugins, async () => {
        throw new ModuleBootError("module tree rejected", [noSlot("/PlatformModule/WebModule")]);
      }),
    ).rejects.toThrow("module tree rejected");
    await expect(
      bootWithoutUnsatisfied(plugins, async () => {
        throw new Error("create failed");
      }),
    ).rejects.toThrow("create failed");
  });
});
