/**
 * Current-user routes: GET /api/me, PUT /api/me/password, GET|PUT /api/me/prefs.
 * ui_prefs is free-form JSON (theme / lastProjectId / credentialGuideSeen, etc.): GET reads
 * it whole, PUT shallow-merges (PATCH semantics) — several independent writers each write
 * their own fields without clobbering each other.
 */
import { Hono } from "hono";
import type { MeResponse, PrefsResponse, UiPrefs } from "../../api/types.js";
import { toUserInfo } from "../../auth/service.js";
import type { AppEnv } from "../../auth/middleware.js";
import { readJson, requireString } from "../validate.js";
import type { AppDeps } from "../../app.js";

export function meRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", (c) => {
    return c.json({ user: toUserInfo(c.var.user) } satisfies MeResponse);
  });

  // Self-service password change (user settings): validates the old password; on success, the initial-password prompt disappears from GET /api/me.
  app.put("/password", async (c) => {
    const body = await readJson(c);
    const oldPassword = requireString(body, "oldPassword", { label: "oldPassword" });
    const newPassword = requireString(body, "newPassword", { label: "newPassword" });
    await deps.authService.changePassword(c.var.user.userId, oldPassword, newPassword);
    return c.body(null, 204);
  });

  app.get("/prefs", (c) => {
    const raw = deps.prefsRepo.get(c.var.user.userId);
    let prefs: UiPrefs = {};
    if (raw !== null) {
      try {
        prefs = JSON.parse(raw) as UiPrefs;
      } catch {
        prefs = {}; // Corrupted prefs fall back to an empty object
      }
    }
    return c.json({ prefs } satisfies PrefsResponse);
  });

  // PATCH semantics: the request body is **shallow-merged** into existing prefs, not a
  // full replace. prefs has several independent writers (lastProjectId /
  // credentialGuideSeen, etc., each writing their own field); a full replace would wipe
  // out each other's fields — e.g. writing lastProjectId when switching Projects would
  // clear credentialGuideSeen, breaking the "show onboarding once ever" guarantee.
  app.put("/prefs", async (c) => {
    const body = await readJson(c);
    const raw = deps.prefsRepo.get(c.var.user.userId);
    let current: UiPrefs = {};
    if (raw !== null) {
      try {
        current = JSON.parse(raw) as UiPrefs;
      } catch {
        current = {}; // Corrupted prefs fall back to an empty object (consistent with GET).
      }
    }
    const merged = { ...current, ...(body as UiPrefs) };
    deps.prefsRepo.set(c.var.user.userId, JSON.stringify(merged));
    return c.json({ prefs: merged } satisfies PrefsResponse);
  });

  return app;
}
