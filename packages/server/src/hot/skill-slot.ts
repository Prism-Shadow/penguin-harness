/**
 * Skill slot: a hot-loadable script that contributes tools to the platform.
 *
 * The script SOURCE lives in the parked context (code + state travel together
 * — the snapshot equation in miniature), is evaluated with a context and must
 * return a contract object (arktype-validated); the object — not the module —
 * is what the system operates on afterwards.
 *
 * Setup is DEFERRED: children boot before their parent in the kernel, and the
 * ToolRegistry is created by the platform's create(), so the slot only
 * evaluates + validates at boot; the platform calls setup(registry) once the
 * registry exists (and again from scratch after every platform swap — the
 * reseed pattern: tools are derived state, never parked).
 *
 * Cordis pitfalls defended against (from the dsh study):
 * - every registration rides THIS node's ctx.effect, so unloading the skill
 *   deregisters exactly its tools (self-cleaning effects invariant);
 * - once the node starts unloading, new registrations are refused instead of
 *   leaking (dsh local fix #6: no new effects during UNLOADING);
 * - the setup context is a per-slot closure, so disposal attribution cannot
 *   land on the wrong owner (the analog of dsh's "service methods must be
 *   prototype methods, not arrow properties" trap);
 * - nothing lives at module level: no cross-reload singletons.
 */
import type { Impl, Json, Park } from "@prismshadow/penguin-core/kernel";
import { defineIface, s } from "@prismshadow/penguin-core/kernel";
import { evalHotScript, validateSkillObject } from "./script.js";
import type { SkillObject } from "./script.js";
import type { ToolRegistry } from "./tools.js";

export interface SkillSlotApi extends Park {
  describe(): { name: string; version: number; description?: string };
  /** Called by the platform once its ToolRegistry exists (deferred setup). */
  setup(slotId: string, registry: ToolRegistry): void;
}

export type SkillSlotCtx = { script: string; rev: number; state: Json };

export const SkillSlotIface = defineIface<SkillSlotApi, SkillSlotCtx>({
  name: "skill-slot",
  version: 1,
  context: s.object<SkillSlotCtx>({ script: s.string(), rev: s.number(), state: s.json() }),
  methods: ["park", "describe", "setup"],
});

export const skillSlotImpl: Impl<SkillSlotApi, SkillSlotCtx> = {
  create(nodeCtx, context) {
    // Eval + context → object; everything below operates on the object.
    const obj: SkillObject = validateSkillObject(
      evalHotScript(context.script, { state: context.state }),
    );

    let unloading = false;
    nodeCtx.effect(() => {
      unloading = true;
    });

    return {
      park: () => ({
        script: context.script,
        rev: context.rev,
        state: (obj.park?.() as Json | undefined) ?? null,
      }),
      describe: () => ({
        name: obj.name,
        version: obj.version,
        ...(obj.description !== undefined ? { description: obj.description } : {}),
      }),
      setup(slotId, registry) {
        obj.setup({
          registerTool: (tool) => {
            if (unloading) {
              throw new Error(`skill '${slotId}' is unloading; cannot register new tools`);
            }
            // Effect-bound: the disposer rides this slot's lifecycle.
            nodeCtx.effect(registry.register(slotId, tool));
          },
        });
      },
    };
  },
};
