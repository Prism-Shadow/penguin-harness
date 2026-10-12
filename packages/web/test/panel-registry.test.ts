/**
 * The dock's panel registry (features/dock/panel-registry.ts): every panel kind is a
 * definition registered under its id, and every surface that lists, names or renders panels
 * reads it — the seam a plugin's panel will plug into.
 *
 * - A definition registers under its id, a second one with the same id replaces it, and the
 *   returned function takes it back out.
 * - The list holds the offered definitions only, by `order` and then id.
 * - Subscribers hear about registrations and about a definition's `offered` changing.
 * - A tab whose id nothing has registered still gets a name and a mark: the id itself and the
 *   puzzle glyph.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { ICONS } from "@prismshadow/penguin-ui";
import {
  dockPanelDefinition,
  dockPanels,
  dockPanelsVersion,
  panelGlyphPath,
  panelLabel,
  registerDockPanel,
  subscribeDockPanels,
} from "../src/features/dock/panel-registry";
import type { DockPanelDefinition } from "../src/features/dock/panel-registry";

/** The registry is module-level: each test takes back everything it registered. */
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function register(definition: DockPanelDefinition): () => void {
  const unregister = registerDockPanel(definition);
  cleanups.push(unregister);
  return unregister;
}

function panel(
  id: string,
  order: number,
  extra: Partial<DockPanelDefinition> = {},
): DockPanelDefinition {
  return {
    id,
    label: () => `Label of ${id}`,
    glyph: ICONS.folder,
    order,
    Body: () => null,
    ...extra,
  };
}

const listedIds = (): string[] => dockPanels().map((definition) => definition.id);

describe("the panel registry", () => {
  it("registers a panel, replaces it by id, and unregisters it", () => {
    const first = panel("acme.kanban", 10);
    register(first);
    expect(dockPanelDefinition("acme.kanban")).toBe(first);

    const second = panel("acme.kanban", 10, { label: () => "Board" });
    const unregister = register(second);
    expect(dockPanelDefinition("acme.kanban")).toBe(second);
    expect(listedIds()).toEqual(["acme.kanban"]);

    unregister();
    expect(dockPanelDefinition("acme.kanban")).toBeUndefined();
    expect(listedIds()).toEqual([]);
  });

  it("lists the offered panels by order, then id", () => {
    register(panel("test.gamma", 20));
    register(panel("test.beta", 10));
    register(panel("test.alpha", 20));
    register(panel("test.hidden", 5, { offered: () => false }));
    expect(listedIds()).toEqual(["test.beta", "test.alpha", "test.gamma"]);
  });

  it("notifies subscribers on a registration and on an offered change", () => {
    const offeredListeners = new Set<() => void>();
    let offered = true;
    register(
      panel("test.web", 10, {
        offered: () => offered,
        subscribeOffered: (listener) => {
          offeredListeners.add(listener);
          return () => offeredListeners.delete(listener);
        },
      }),
    );
    const listener = vi.fn();
    cleanups.push(subscribeDockPanels(listener));

    register(panel("test.other", 20));
    expect(listener).toHaveBeenCalled();

    listener.mockClear();
    const before = dockPanelsVersion();
    offered = false;
    for (const notifyOffered of [...offeredListeners]) notifyOffered();
    expect(listener).toHaveBeenCalled();
    expect(dockPanelsVersion()).not.toBe(before);
    expect(listedIds()).toEqual(["test.other"]);
  });

  it("names an unregistered id by the id itself and marks it with the puzzle glyph", () => {
    register(panel("test.known", 10, { label: () => "Known", glyph: ICONS.globe }));
    expect(panelLabel("test.known")).toBe("Known");
    expect(panelGlyphPath("test.known")).toBe(ICONS.globe);
    expect(panelLabel("acme.kanban")).toBe("acme.kanban");
    expect(panelGlyphPath("acme.kanban")).toBe(ICONS.puzzle);
  });
});
