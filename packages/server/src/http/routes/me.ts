/**
 * Current-user routes: GET /api/me, PUT /api/me/password, PUT /api/me/profile,
 * GET|PUT /api/me/prefs, GET|PATCH /api/me/drafts, GET|PUT /api/me/background-image.
 * ui_prefs is free-form JSON (theme / lastProjectId / credentialGuideSeen, etc.): GET reads
 * it whole, PUT shallow-merges (PATCH semantics) — several independent writers each write
 * their own fields without clobbering each other. Free-form does not mean unbounded: a key
 * carrying user-authored text is validated and capped on the way in (draftShortcuts).
 *
 * The profile (nickname + avatar) is a column pair on `users` rather than a prefs key: it is
 * read back by surfaces other than the browser that wrote it (the admin user list names the
 * nickname), and a blob capped at 128 KiB does not belong in a free-form JSON document that
 * every unrelated writer re-serializes whole. The background image is kept apart for the same
 * reason, in a table of its own: ui_prefs carries only its id, which a browser compares with the
 * image it has cached before asking for the image itself.
 *
 * Drafts are rows rather than prefs keys: there are many of them, each is written on its own as
 * someone types, and each must go when the Session or Project it belongs to is deleted.
 */
import { Hono } from "hono";
import { setCookie } from "hono/cookie";
import { createHash } from "node:crypto";
import { BACKGROUND_IMAGE_MAX_CHARS } from "../../api/types.js";
import type {
  BackgroundImagePutResponse,
  BackgroundImageResponse,
  DraftsResponse,
  MeResponse,
  PrefsResponse,
  UiPrefs,
  UpdateProfileRequest,
  UpdateProfileResponse,
} from "../../api/types.js";
import { toUserInfo } from "../../auth/service.js";
import { cookieOptions, sessionCookieName } from "../../auth/middleware.js";
import type { AppEnv } from "../../auth/middleware.js";
import { badRequest, readJson, requireString } from "../validate.js";
import { HttpError } from "../errors.js";
import type { ServerConfig } from "../../config.js";
import type { DesktopService } from "../../services/desktop-service.js";

/** What this route group reaches — bound by its module (src/modules). */
export interface MeRouteDeps {
  authService: Auth;
  config: ServerConfig;
  desktop: DesktopService | null;
  prefsRepo: UiPrefsStore;
  draftsRepo: UserDraftsStore;
  backgroundImages: BackgroundImageStore;
  serverSettingsRepo: Settings;
  /** The `users` table itself, for the one route that writes a column no service owns (PUT /api/me/profile). */
  usersRepo: Users;
}
import { resolvePreviewTarget } from "../../services/preview-token.js";
import { validateDraftShortcuts } from "../../services/draft-shortcuts.js";
import { validateKeybindings } from "../../services/keybindings.js";
import { validateAccountSettings } from "../../services/account-settings.js";
import {
  DRAFTS_MAX_COUNT,
  DRAFTS_MAX_TOTAL_CHARS,
  parseDraftsPatch,
} from "../../services/user-drafts.js";
import {
  INLINE_IMAGE_MAX_MB,
  MAX_ATTACHMENT_COUNT,
  MAX_ATTACHMENT_MB,
  MIN_ATTACHMENT_MB,
} from "../../services/attachment-limits.js";
import { Bind, Component, Use } from "@prismshadow/penguin-core/kernel";
import type { ClassCtx } from "@prismshadow/penguin-core/kernel";
import { Config, Desktop } from "../../hmr/capabilities.js";
import type { Auth, Users } from "../../mechanisms/identity.js";
import type { Settings, UiPrefsStore } from "../../mechanisms/settings.js";
import type { BackgroundImageStore, UserDraftsStore } from "../../mechanisms/account-data.js";

/** Nickname bounds, counted in user-perceived code points so a CJK name is 32 characters, not 96. */
const DISPLAY_NAME_MIN = 1;
const DISPLAY_NAME_MAX = 32;

/**
 * Avatar cap, in characters of the data URL as it arrives — the same number the browser
 * measures its re-encode against, so the client and this check can never disagree about what
 * "too large" means. 131072 characters of base64 hold roughly 96 KiB of image.
 */
const AVATAR_MAX_CHARS = 131072;

/** The three formats the picker offers, all of which every target browser can re-encode. */
const AVATAR_DATA_URL = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;

/**
 * A background image the Web App can lay under its pages: the same shape its own reader accepts
 * (`isBackgroundImage` in the UI package), padding only at the end.
 */
const BACKGROUND_DATA_URL = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/;

/** The stored form of a background image, or a 400 naming what is wrong with it. */
function parseBackgroundImage(raw: unknown): string | null {
  if (raw === null) return null;
  if (typeof raw !== "string") throw badRequest("image must be a string or null.");
  // Length first: the pattern below is linear in the input, and a caller may send megabytes.
  if (raw.length > BACKGROUND_IMAGE_MAX_CHARS) {
    throw badRequest(`image must be at most ${BACKGROUND_IMAGE_MAX_CHARS} characters.`);
  }
  if (!BACKGROUND_DATA_URL.test(raw)) {
    throw badRequest(
      "image must be a base64 data URL of type image/png, image/jpeg or image/webp.",
    );
  }
  return raw;
}

/** An image's id: a digest of its bytes, so storing the same image again changes nothing a browser compares. */
function backgroundImageId(image: string): string {
  return createHash("sha256").update(image).digest("base64url").slice(0, 22);
}

/** The stored prefs document; a corrupted one reads as empty, as GET has always read it. */
function readPrefs(store: UiPrefsStore, userId: string): UiPrefs {
  const raw = store.get(userId);
  if (raw === null) return {};
  try {
    return JSON.parse(raw) as UiPrefs;
  } catch {
    return {};
  }
}

/**
 * The stored form of a nickname: trimmed, since leading and trailing spaces are invisible in
 * every surface that renders it and would make two names look identical. Length is measured in
 * code points (Array.from) rather than UTF-16 units, so a 32-character Chinese name fits and a
 * 32-emoji one does not sneak past a byte count.
 */
function parseDisplayName(raw: unknown): string | null {
  if (raw === null) return null;
  if (typeof raw !== "string") throw badRequest("displayName must be a string or null.");
  const trimmed = raw.trim();
  const length = Array.from(trimmed).length;
  if (length < DISPLAY_NAME_MIN || length > DISPLAY_NAME_MAX) {
    throw badRequest(
      `displayName must be ${DISPLAY_NAME_MIN} to ${DISPLAY_NAME_MAX} characters once trimmed.`,
    );
  }
  // Control characters carry no glyph: they would let a name imitate another one, or break the
  // line it is rendered on.
  if (/\p{Cc}/u.test(trimmed)) {
    throw badRequest("displayName must not contain control characters.");
  }
  return trimmed;
}

/** The stored form of an avatar: the data URL itself, validated shape-first, then decoded. */
function parseAvatar(raw: unknown): string | null {
  if (raw === null) return null;
  if (typeof raw !== "string") throw badRequest("avatar must be a string or null.");
  // Length first: the pattern below is linear in the input, and a caller may send megabytes.
  if (raw.length > AVATAR_MAX_CHARS) {
    throw badRequest(`avatar must be at most ${AVATAR_MAX_CHARS} characters.`);
  }
  if (!AVATAR_DATA_URL.test(raw)) {
    throw badRequest(
      "avatar must be a base64 data URL of type image/png, image/jpeg or image/webp.",
    );
  }
  const payload = raw.slice(raw.indexOf(",") + 1);
  // The pattern admits the alphabet but not the arithmetic: a length that is 1 mod 4, or padding
  // in the middle, is not decodable base64 and would be stored as an <img src> that never loads.
  let decodedLength: number;
  try {
    decodedLength = atob(payload).length;
  } catch {
    throw badRequest("avatar is not valid base64.");
  }
  if (decodedLength === 0) throw badRequest("avatar is not valid base64.");
  return raw;
}

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
      companyMode: deps.serverSettingsRepo.getCompanyMode(),
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
          sessionCookieName(c.req.url, c.req.header("origin") !== undefined),
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

  /**
   * Nickname and avatar, as a patch: an absent field keeps what is stored, `null` clears it.
   *
   * Open to EVERY authenticated session, the desktop shell's own token session included —
   * deliberately not the password route's gate above. That gate exists because a password
   * change needs a password to check against, which a token session has never seen; a profile
   * is just the account's own display data, and the shell's window is a signed-in account like
   * any other.
   */
  app.put("/profile", async (c) => {
    const body = await readJson(c);
    const patch: UpdateProfileRequest = {};
    if (body.displayName !== undefined) patch.displayName = parseDisplayName(body.displayName);
    if (body.avatar !== undefined) patch.avatar = parseAvatar(body.avatar);
    // A body naming neither field cannot mean anything: answering 200 with the row unchanged
    // would let a client's typo read as a successful save.
    if (patch.displayName === undefined && patch.avatar === undefined) {
      throw badRequest("Request body must name displayName or avatar.");
    }
    deps.usersRepo.updateProfile(c.var.user.userId, patch);
    const updated = deps.usersRepo.findById(c.var.user.userId);
    if (updated === null) {
      // The session resolved to this user one middleware ago, so the row can only be gone if
      // an admin deleted the account mid-request.
      throw new HttpError(404, "not_found", "Account no longer exists.");
    }
    return c.json({ user: toUserInfo(updated) } satisfies UpdateProfileResponse);
  });

  app.get("/prefs", (c) => {
    return c.json({ prefs: readPrefs(deps.prefsRepo, c.var.user.userId) } satisfies PrefsResponse);
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
    if (body.keybindings !== undefined) {
      body.keybindings = validateKeybindings(body.keybindings);
    }
    // Which browser the user's agents drive has its own route, which checks what the user may
    // choose, waits out an agent's action in flight, and tells their windows; a plain prefs
    // write would skip all three.
    if (body.browserBackend !== undefined) {
      throw badRequest(
        "browserBackend is chosen through PUT /api/builtin-browser/backend, not the prefs.",
      );
    }
    // Names the image the background route stored; written anywhere else it would name an
    // image the account does not hold, and every browser would keep asking for it.
    if (body.backgroundImageId !== undefined) {
      throw badRequest("backgroundImageId is set by PUT /api/me/background-image, not the prefs.");
    }
    validateAccountSettings(body);
    const merged = { ...readPrefs(deps.prefsRepo, c.var.user.userId), ...(body as UiPrefs) };
    deps.prefsRepo.set(c.var.user.userId, JSON.stringify(merged));
    return c.json({ prefs: merged } satisfies PrefsResponse);
  });

  /**
   * The custom background image. The id goes into ui_prefs in the same request, so the prefs a
   * browser reads at load already say whether its cached image is the account's.
   */
  app.get("/background-image", (c) => {
    const stored = deps.backgroundImages.get(c.var.user.userId);
    return c.json({
      image: stored?.image ?? null,
      imageId: stored?.imageId ?? null,
    } satisfies BackgroundImageResponse);
  });

  app.put("/background-image", async (c) => {
    const body = await readJson(c);
    if (body.image === undefined)
      throw badRequest("Request body must name image (null removes it).");
    const image = parseBackgroundImage(body.image);
    const userId = c.var.user.userId;
    let imageId: string | null = null;
    if (image === null) {
      deps.backgroundImages.clear(userId);
    } else {
      imageId = backgroundImageId(image);
      deps.backgroundImages.set(userId, { image, imageId });
    }
    const prefs = { ...readPrefs(deps.prefsRepo, userId), backgroundImageId: imageId };
    deps.prefsRepo.set(userId, JSON.stringify(prefs));
    return c.json({ imageId } satisfies BackgroundImagePutResponse);
  });

  /** Every draft the account keeps. A row whose JSON no longer parses is left out, not served broken. */
  app.get("/drafts", (c) => {
    const drafts: Record<string, unknown> = {};
    for (const row of deps.draftsRepo.list(c.var.user.userId)) {
      try {
        drafts[row.key] = JSON.parse(row.valueJson) as unknown;
      } catch {
        // Never written by this route (it stores JSON.stringify's output): a hand-edited row.
      }
    }
    return c.json({ drafts } satisfies DraftsResponse);
  });

  /** Writes and removes drafts together; past the account's bound, its oldest other drafts go. */
  app.patch("/drafts", async (c) => {
    const writes = parseDraftsPatch(await readJson(c));
    deps.draftsRepo.apply(c.var.user.userId, writes, {
      maxCount: DRAFTS_MAX_COUNT,
      maxChars: DRAFTS_MAX_TOTAL_CHARS,
    });
    return c.body(null, 204);
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
  @Use() private readonly drafts!: UserDraftsStore;
  @Use() private readonly backgroundImages!: BackgroundImageStore;
  @Use() private readonly settings!: Settings;
  @Use() private readonly users!: Users;
  @Bind("MeRoutes.routes") routes!: Hono<AppEnv>;
  setup() {
    this.routes = meRoutes({
      authService: this.auth,
      config: this.config,
      desktop: this.desktop.current() as DesktopService | null,
      prefsRepo: this.prefs,
      draftsRepo: this.drafts,
      backgroundImages: this.backgroundImages,
      serverSettingsRepo: this.settings,
      usersRepo: this.users,
    });
  }
}
