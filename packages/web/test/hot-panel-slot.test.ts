/**
 * Web hot-panel slot: park/boot swap keeps the state document while the code
 * (module rev) changes — the UI half of the hot-update MVP, tested without a
 * DOM through an injected module loader.
 */
import type { ComponentType } from "react";
import { describe, expect, it } from "vitest";
import type { StoreApi } from "zustand/vanilla";
import { createStore } from "zustand/vanilla";
import type { Json } from "@prismshadow/penguin-core/kernel";
import type { PanelDeps, PanelModule, PanelModuleLoader } from "../src/features/hot/panel-slot";
import { bootPanel, swapPanel } from "../src/features/hot/panel-slot";

const deps: PanelDeps = { react: null, createStore, useStore: null };
const NullComponent = (() => null) as unknown as ComponentType;

describe("hot panel slot", () => {
  it("boots, parks, and swaps with the state document riding across", async () => {
    // The loader stands in for `import()`: each rev serves a different module
    // version; the created stores are captured so the test can mutate state.
    const stores: StoreApi<{ text: string }>[] = [];
    const loader: PanelModuleLoader = (rev) => {
      const module: PanelModule = {
        name: "fake-panel",
        version: rev === "rev-1" ? 1 : 2,
        create(_deps, state) {
          const old = (state ?? {}) as { text?: string };
          const store = createStore(() => ({ text: old.text ?? "" }));
          stores.push(store);
          return { park: () => store.getState() as Json, Component: NullComponent };
        },
      };
      return Promise.resolve({ panel: module });
    };

    const inst = await bootPanel(deps, loader, "rev-1");
    expect(inst.api.describe()).toEqual({ name: "fake-panel", version: 1 });

    stores[0]!.setState({ text: "draft survives" });
    const parked = inst.park();
    expect(parked.self).toEqual({ rev: "rev-1", state: { text: "draft survives" } });

    const swapped = await swapPanel(inst, deps, loader, "rev-2");
    expect(swapped.api.describe()).toEqual({ name: "fake-panel", version: 2 });
    expect(swapped.park().self).toEqual({ rev: "rev-2", state: { text: "draft survives" } });
  });

  it("rejects a module without the panel contract", async () => {
    const empty: PanelModuleLoader = () => Promise.resolve({});
    await expect(bootPanel(deps, empty, "rev-1")).rejects.toThrow(/panel/);
  });
});
