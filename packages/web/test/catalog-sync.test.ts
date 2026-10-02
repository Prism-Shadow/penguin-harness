/**
 * What 「同步新增模型」 / "Add new models" would add (catalog-sync.ts's catalogDelta), as the
 * Models badge, the page notice and the header button all read it off a SAVED table — the same
 * rule the server's add applies: the catalog's presets minus the pairs already stored.
 *
 * - Given a table holding every preset, nothing is new, and no badge is raised.
 * - Given a table lacking presets — never added, or deleted by the user — exactly those are new,
 *   in catalog order, and they are what the badge's signature names.
 * - Given a stored preset whose price, context window, vision flag, name or protocol differs
 *   from the catalog, it is NOT counted: that may be the user's own edit, and nothing but
 *   "Restore defaults" rewrites an existing model.
 * - A retired catalog row is never offered, and the user's own models are invisible.
 * - The badge and the add agree: the to-do counts and names exactly the presets the add puts in.
 */
import { describe, expect, it } from "vitest";
import {
  catalogEntryFor,
  catalogModelEntries,
  presetModelEntries,
} from "@prismshadow/penguin-core/model-catalog";
import type { ModelInfo } from "@prismshadow/penguin-server/api";
import { catalogDelta } from "../src/features/models/catalog-sync";
import { presetUpdateTodo } from "../src/lib/todo-badges";

const PRESETS = presetModelEntries();
const ref = (p: { provider: string; model_id: string }) => `${p.provider}/${p.model_id}`;

/** A saved model as GET /models sends it, for one catalog preset. */
const saved = (p: { provider: string; model_id: string }, patch: Partial<ModelInfo> = {}) =>
  ({
    provider: p.provider,
    modelId: p.model_id,
    isDefault: false,
    effective: { baseUrlSource: "none", clientTypeSource: "none", apiKeySource: "none" },
    ...patch,
  }) satisfies ModelInfo;

/** The whole catalog, as a freshly created Project stores it. */
const FULL = PRESETS.map((p) => saved(p));

describe("catalogDelta", () => {
  it("finds nothing new in a table that holds every preset", () => {
    expect(catalogDelta(FULL)).toEqual({ added: 0, refs: [] });
    expect(presetUpdateTodo(catalogDelta(FULL))).toBeNull();
  });

  it("names the presets the table lacks, deleted ones included, in catalog order", () => {
    const [first, , third] = PRESETS;
    const table = FULL.filter(
      (m) =>
        !(m.provider === first!.provider && m.modelId === first!.model_id) &&
        !(m.provider === third!.provider && m.modelId === third!.model_id),
    );
    expect(catalogDelta(table)).toEqual({ added: 2, refs: [ref(first!), ref(third!)] });
    // An empty table is a Project missing all of them.
    expect(catalogDelta([]).refs).toEqual(PRESETS.map(ref));
  });

  it("does not count a stored preset that differs from the catalog: that may be the user's edit", () => {
    const p = PRESETS.find((e) => e.pricing !== undefined && e.context_window !== undefined)!;
    const edited = FULL.map((m) =>
      m.provider === p.provider && m.modelId === p.model_id
        ? saved(p, {
            displayName: "My own name",
            contextWindow: 1234,
            vision: false,
            clientType: "openai-chat",
            pricing: { cacheRead: 9, cacheWrite: 9, output: 9 },
          })
        : m,
    );
    expect(catalogDelta(edited)).toEqual({ added: 0, refs: [] });
  });

  it("never offers a retired catalog row, and does not see the user's own models", () => {
    const retired = catalogModelEntries().find(
      (e) => catalogEntryFor(e.provider, e.model_id)?.retired === true,
    );
    if (retired !== undefined) expect(catalogDelta([]).refs).not.toContain(ref(retired));
    const mine = { provider: "custom", model_id: "my-own" };
    expect(catalogDelta([...FULL, saved(mine)])).toEqual({ added: 0, refs: [] });
  });
});

describe("the badge and the add agree", () => {
  it("counts the same presets the add would put in, under one number", () => {
    const table = FULL.slice(3);
    const delta = catalogDelta(table);
    const todo = presetUpdateTodo(delta)!;
    expect(todo.count).toBe(delta.added);
    expect(todo.items).toEqual(PRESETS.slice(0, 3).map(ref));
  });
});
