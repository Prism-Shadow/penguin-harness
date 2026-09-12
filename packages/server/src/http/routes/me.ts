/**
 * Current-user routes: GET /api/me, PUT /api/me/password, GET|PUT /api/me/prefs.
 * ui_prefs is free-form JSON (theme / lastProjectId / credentialGuideSeen, etc.): GET reads
 * it whole, PUT shallow-merges (PATCH semantics) — several independent writers each write
 * their own fields without clobbering each other. Free-form does not mean unbounded: a key
 * carrying user-authored text is validated and capped on the way in (draftShortcuts).
 */
import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import type { MeResponse, PrefsResponse, UiPrefs } from "../../api/types.js";
import { toUserInfo } from "../../auth/service.js";
import { SESSION_COOKIE, cookieOptions } from "../../auth/middleware.js";
import type { AppEnv } from "../../auth/middleware.js";
import { readJson, requireString } from "../validate.js";
import type { ServerConfig } from "../../config.js";
import type { DesktopService } from "../../services/desktop-service.js";

/** What this route group reaches — bound by its module (src/modules). */
export interface MeRouteDeps {
  authService: Auth;
  config: ServerConfig;
  desktop: DesktopService | null;
  prefsRepo: UiPrefsStore;
  serverSettingsRepo: Settings;
}
import { resolvePreviewTarget } from "../../services/preview-token.js";
import { validateDraftShortcuts } from "../../services/draft-shortcuts.js";
import {
  INLINE_IMAGE_MAX_MB,
  MAX_ATTACHMENT_COUNT,
  MAX_ATTACHMENT_MB,
  MIN_ATTACHMENT_MB,
} from "../../services/attachment-limits.js";
import { Bind, Component, Use } from "@prismshadow/penguin-core/kernel";
import type { ClassCtx } from "@prismshadow/penguin-core/kernel";
import { Config, Desktop } from "../../hmr/capabilities.js";
import type { Auth } from "../../mechanisms/identity.js";
import type { Settings, UiPrefsStore } from "../../mechanisms/settings.js";

export function meRoutes(deps: MeRouteDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/", (c) => {
    // previewIsolated depends on the host this request came in on, so it is computed
    // here rather than stored: the same server answers on 127.0.0.1, localhost and
    // possibly a LAN address, and only the first two have a loopback counterpart.
    const target = resolvePreviewTarget(
      c.req.url,
      c.req.header("host"),
      deps.config.previewOrigin,
      deps.config,
    );
    // Read per request, not captured once: an admin's change to the limits reaches an already
    // open tab on its next /api/me (a reload, or the settings dialog's own refresh) without a
    // server restart, and a tab that never refetches simply keeps proposing the older number —
    // the server re-validates every upload against the current one regardless.
    return c.json({
      user: toUserInfo(c.var.user),
      previewIsolated: target !== null,
      desktopMode: deps.desktop !== null,
      sessionVia: c.var.sessionVia,
      uploadLimits: {
        ...deps.serverSettingsRepo.getAttachmentLimitsMb(),
        attachmentMaxCount: MAX_ATTACHMENT_COUNT,
        imageMaxMb: INLINE_IMAGE_MAX_MB,
        attachmentLimitMinMb: MIN_ATTACHMENT_MB,
        attachmentLimitMaxMb: MAX_ATTACHMENT_MB,
      },
    } satisfies MeResponse);
  });

  // Self-service password change (user settings): validates the old password; on success, the initial-password prompt disappears from GET /api/me.
  // Two kinds of session may omit oldPassword, because for them there is no old password to
  // know — the account's current one is random and was never shown: the desktop shell's own
  // window, and a session claimed through this boot's first-login link.
  app.put("/password", async (c) => {
    const body = await readJson(c);
    const newPassword = requireString(body, "newPassword", { label: "newPassword" });
    const desktopSession = deps.desktop !== null && c.var.sessionVia === "desktop";
    const setupSession = c.var.sessionVia === "setup";
    if ((desktopSession || setupSession) && body.oldPassword === undefined) {
      await deps.authService.setInitialPassword(c.var.user.userId, newPassword);
      // Claiming deletes every first-login session, this request's included, so without a
      // replacement the next call 401s and a brand-new user lands back on the login page.
      // Signed in with the password just set: an ordinary login, not a session given on trust.
      if (setupSession) {
        const { token } = await deps.authService.login(c.var.user.userId, newPassword);
        setCookie(
          c,
          SESSION_COOKIE,
          token,
          cookieOptions(c, deps.authService.sessionTtlMs, deps.config.trustProxy),
        );
      }
    } else {
      const oldPassword = requireString(body, "oldPassword", { label: "oldPassword" });
      await deps.authService.changePassword(c.var.user.userId, oldPassword, newPassword);
    }
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
    // The one known key whose value is text the user wrote, so the one that needs a bound here:
    // everything else in ui_prefs is a flag or an id, and the store itself has no schema to lean
    // on. Validated (and normalized) before the merge, so a rejected write stores nothing.
    if (body.draftShortcuts !== undefined) {
      body.draftShortcuts = validateDraftShortcuts(body.draftShortcuts);
    }
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

@Component({
  contributes: {
    "HttpModule.routes": [
      {
        id: "MeRoutes.routes",
        prefix: "/api/me",
        auth: "user",
        order: 10,
      },
    ],
  },
})
export class MeRoutes {
  @Use() private readonly config!: Config;
  @Use() private readonly desktop!: Desktop;
  @Use() private readonly auth!: Auth;
  @Use() private readonly prefs!: UiPrefsStore;
  @Use() private readonly settings!: Settings;
  @Bind("MeRoutes.routes") routes!: Hono<AppEnv>;
  setup() {
    this.routes = meRoutes({
      authService: this.auth,
      config: this.config,
      desktop: this.desktop.current() as DesktopService | null,
      prefsRepo: this.prefs,
      serverSettingsRepo: this.settings,
    });
  }
}
