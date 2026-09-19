/**
 * A pushed platform boots on the runtime that is already there, and that runtime publishes
 * the config ITS build knew. Settings added to Config since — and not named by the hot-update
 * seam's config interface (hmr/capabilities.ts's HMR_INTERFACES) — are therefore optional in
 * the interface, and an absent one reads as its default; otherwise the kernel refuses the push
 * ("does not satisfy 'Config': missing [...]") and every machine on an older runtime keeps
 * the platform it had. `supervised` is NOT one of them: the seam claims it by name, so a
 * runtime without it is refused at the claim with a reason, before any module boots.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createTestApp, loginAdmin, type TestApp } from "./helpers.js";

describe("a platform on a runtime whose config predates newer settings", () => {
  let t: TestApp | null = null;
  afterEach(async () => {
    await t?.cleanup();
    t = null;
  });

  it("boots and serves without cliEntry or pluginIndexUrl", async () => {
    t = await createTestApp({ config: { cliEntry: undefined, pluginIndexUrl: undefined } });
    const admin = await loginAdmin(t.app);
    const res = await t.app.request("/api/projects/default_project/agents", {
      headers: { cookie: admin.cookie },
    });
    expect(res.status).toBe(200);
  });
});
