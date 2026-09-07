/**
 * The node names an older runtime resolves in a pushed platform's tree.
 *
 * A tree node's NAME is a wire contract across generations, exactly like a resource id: the
 * runtime that boots a pushed platform looks nodes up by name (`createHmrApp` in app.ts), and
 * a parked document is keyed by name too. Renaming one is therefore not a refactor — it is a
 * push that kills every older installation at boot.
 *
 * That happened: the HMR-layer rename (#636) took `RuntimeModule` with it, and a desktop
 * whose program predated the push died with `no api 'Log' on module 'RuntimeModule'` before
 * it could serve anything. These names are pinned here so the next rename has to argue with a
 * test rather than with an installation.
 */
import { describe, expect, it } from "vitest";
import { createTestApp } from "./helpers.js";

/** What app.ts's createHmrApp resolves out of the tree, by name. */
const RESOLVED_BY_THE_RUNTIME: ReadonlyArray<[module: string, api: string]> = [
  ["ObservabilityModule", "Errors"],
  ["RuntimeModule", "Log"],
  ["SettingsModule", "Settings"],
  ["ProjectsModule", "Access"],
  ["IdentityModule", "Auth"],
  // The business surface itself: bootAppDeps refuses a platform that builds none.
  ["HttpModule", "http"],
];

describe("the names a runtime resolves in a pushed tree", () => {
  it("are still there", async () => {
    const t = await createTestApp();
    try {
      for (const [module, api] of RESOLVED_BY_THE_RUNTIME) {
        expect(() => t.deps.tree.api(module, api), `${module}.${api}`).not.toThrow();
      }
    } finally {
      await t.cleanup();
    }
  });
});
