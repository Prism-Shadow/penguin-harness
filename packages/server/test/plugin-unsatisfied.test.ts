import { describe, expect, it } from "vitest";
import {
  ModuleBootError,
  type ModuleDef,
  type ModuleTree,
  type Problem,
} from "@prismshadow/penguin-core/kernel";
import type { LoadedPlugin } from "../src/plugin/host.js";
import {
  UnsatisfiedPluginsError,
  bootWithoutUnsatisfied,
  pluginsBehind,
} from "../src/plugin/unsatisfied.js";

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
    const { tree: booted, unsatisfied } = await bootWithoutUnsatisfied(
      plugins,
      async ({ modules }) => {
        const slots = Object.keys(modules[0]!.manifest.contributes);
        seen.push(slots);
        if (slots.includes("WebModule.quickStarts")) {
          throw new ModuleBootError("module tree rejected", [noSlot("/PlatformModule/Proposals")]);
        }
        return tree;
      },
    );
    expect(booted).toBe(tree);
    expect(seen).toEqual([["WebModule.quickStarts", "Kept.slot"], ["Kept.slot"]]);
    // Still running, and named with what it runs without.
    expect(unsatisfied).toEqual([
      {
        specifier: "@x/proposals",
        disabled: false,
        reason:
          "/PlatformModule/Proposals: contributes to 'WebModule.quickStarts', which no visible module declares",
      },
    ]);
  });

  it("leaves out a plugin a wiring problem is traced to, and says which", async () => {
    const plugins = [plugin("@x/claude-code", "ClaudeCode"), plugin("@x/lang", "Languages")];
    const seen: string[][] = [];
    const { tree: booted, unsatisfied } = await bootWithoutUnsatisfied(
      plugins,
      async ({ modules }) => {
        const names = modules.map((m) => m.manifest.name);
        seen.push(names);
        if (names.includes("ClaudeCode")) {
          throw new ModuleBootError("module tree rejected", [
            unresolved("/PlatformModule/ClaudeCode", "SessionSurfacesModule"),
          ]);
        }
        return tree;
      },
    );
    expect(booted).toBe(tree);
    expect(seen).toEqual([["ClaudeCode", "Languages"], ["Languages"]]);
    expect(unsatisfied).toEqual([
      {
        specifier: "@x/claude-code",
        disabled: true,
        reason:
          "/PlatformModule/ClaudeCode: requires.a from 'SessionSurfacesModule': provides nothing",
      },
    ]);
  });

  it("a plugin with a dropped contribution and a wiring problem is left out, for the wiring problem", async () => {
    const plugins = [contributing("@x/both", "Both", "WebModule.quickStarts")];
    const { unsatisfied } = await bootWithoutUnsatisfied(plugins, async ({ modules }) => {
      if (modules.length > 0) {
        throw new ModuleBootError("module tree rejected", [
          noSlot("/PlatformModule/Both"),
          unresolved("/PlatformModule/Both", "SessionSurfacesModule"),
        ]);
      }
      return tree;
    });
    expect(unsatisfied).toHaveLength(1);
    expect(unsatisfied[0]).toMatchObject({ specifier: "@x/both", disabled: true });
    expect(unsatisfied[0]!.reason).toMatch(/requires\.a from 'SessionSurfacesModule'/);
  });

  it("asked to refuse, it throws what the tree would run without and boots nothing more", async () => {
    const plugins = [
      contributing("@x/proposals", "Proposals", "WebModule.quickStarts"),
      plugin("@x/claude-code", "ClaudeCode"),
      plugin("@x/lang", "Languages"),
    ];
    let boots = 0;
    const refused = bootWithoutUnsatisfied(
      plugins,
      async () => {
        boots++;
        throw new ModuleBootError("module tree rejected", [
          noSlot("/PlatformModule/Proposals"),
          unresolved("/PlatformModule/ClaudeCode", "SessionSurfacesModule"),
        ]);
      },
      "refuse",
    );
    await expect(refused).rejects.toBeInstanceOf(UnsatisfiedPluginsError);
    const err = (await refused.catch((e: unknown) => e)) as UnsatisfiedPluginsError;
    expect(err.plugins.map((p) => [p.specifier, p.disabled])).toEqual([
      ["@x/proposals", false],
      ["@x/claude-code", true],
    ]);
    expect(err.message).toMatch(/cannot fully run 2 installed plugins/);
    expect(boots).toBe(1);
  });

  it("asked to refuse, a tree every plugin fits boots as usual", async () => {
    const { tree: booted, unsatisfied } = await bootWithoutUnsatisfied(
      [plugin("@x/lang", "Languages")],
      async () => tree,
      "refuse",
    );
    expect(booted).toBe(tree);
    expect(unsatisfied).toEqual([]);
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
    // The platform's own rejection is not something a pusher can accept away.
    await expect(
      bootWithoutUnsatisfied(
        plugins,
        async () => {
          throw new ModuleBootError("module tree rejected", [noSlot("/PlatformModule/WebModule")]);
        },
        "refuse",
      ),
    ).rejects.toThrow("module tree rejected");
  });
});
