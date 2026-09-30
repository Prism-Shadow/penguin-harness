/**
 * PUT /api/me/profile: the nickname and avatar an account sets for itself.
 *
 * Two properties carry the rest. The route is a PATCH — an absent field keeps what is
 * stored and `null` clears it — so every case asserts what it did NOT touch as well as what
 * it did. And the validation is what keeps a display column safe to render: the cases below
 * are one per rule, because each one has its own message and a shared "400 for bad input"
 * assertion would pass with the wrong check firing.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { MeResponse, UpdateProfileResponse } from "../src/api/types.js";
import {
  apiClient,
  createDesktopApp,
  createTestApp,
  desktopLoginCookie,
  loginAdmin,
  provisionUser,
} from "./helpers.js";
import type { TestApp } from "./helpers.js";

/** A real 1x1 RGBA PNG: the route decodes the payload, so a placeholder string would not do. */
const PNG_1X1 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==";

/** The route's own cap, in characters of the data URL. */
const AVATAR_MAX_CHARS = 131072;

async function errorOf(res: Response): Promise<{ code: string; message: string }> {
  const body = (await res.json()) as { error: { code: string; message: string } };
  return body.error;
}

describe("PUT /api/me/profile", () => {
  let t: TestApp;

  beforeEach(async () => {
    t = await createTestApp();
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("sets both fields, and GET /api/me reads them back", async () => {
    const bob = await provisionUser(t.app, "bob");
    // Neither field is sent at all before one is set, rather than sent as null.
    expect(bob.user.displayName).toBeUndefined();
    expect(bob.user.avatarRev).toBeUndefined();

    const api = apiClient(t.app, bob.cookie);
    const res = await api.put("/api/me/profile", { displayName: "Bob Loblaw", avatar: PNG_1X1 });
    expect(res.status).toBe(200);
    const saved = (await res.json()) as UpdateProfileResponse;
    expect(saved.user.displayName).toBe("Bob Loblaw");
    expect(saved.user.avatarRev).toMatch(/^[0-9a-f]{12}$/);
    // The response is the row, not an echo of the request: the menu updates from it without
    // a second call, so a divergence here would show stale data until the next reload.
    const me = (await (await api.get("/api/me")).json()) as MeResponse;
    expect(me.user.displayName).toBe("Bob Loblaw");
    expect(me.user.avatarRev).toBe(saved.user.avatarRev);
  });

  it("keeps the image out of GET /api/me and serves it from GET /api/me/avatar, cached for good", async () => {
    const bob = await provisionUser(t.app, "bob");
    const api = apiClient(t.app, bob.cookie);
    await api.put("/api/me/profile", { avatar: PNG_1X1 });

    const meRes = await api.get("/api/me");
    const me = (await meRes.json()) as MeResponse & { user: { avatar?: unknown } };
    expect(me.user.avatar).toBeUndefined();
    expect(JSON.stringify(me)).not.toContain("base64");

    const img = await api.get(`/api/me/avatar?rev=${me.user.avatarRev}`);
    expect(img.status).toBe(200);
    expect(img.headers.get("content-type")).toBe("image/png");
    expect(img.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
    const bytes = Buffer.from(await img.arrayBuffer());
    expect(bytes.equals(Buffer.from(PNG_1X1.slice(PNG_1X1.indexOf(",") + 1), "base64"))).toBe(true);

    // A new picture is a new revision, so the cached image is never the old one.
    const other = PNG_1X1.replace("image/png", "image/webp");
    const next = (await (
      await api.put("/api/me/profile", { avatar: other })
    ).json()) as UpdateProfileResponse;
    expect(next.user.avatarRev).not.toBe(me.user.avatarRev);

    // Cleared, there is nothing to serve.
    await api.put("/api/me/profile", { avatar: null });
    expect((await api.get("/api/me/avatar")).status).toBe(404);
  });

  it("serves each account its own avatar only", async () => {
    const bob = await provisionUser(t.app, "bob");
    await apiClient(t.app, bob.cookie).put("/api/me/profile", { avatar: PNG_1X1 });
    const carol = await provisionUser(t.app, "carol");
    expect((await apiClient(t.app, carol.cookie).get("/api/me/avatar")).status).toBe(404);
    expect((await t.app.request("/api/me/avatar")).status).toBe(401);
  });

  it("is a patch: an absent field keeps its value, null clears it", async () => {
    const bob = await provisionUser(t.app, "bob");
    const api = apiClient(t.app, bob.cookie);
    await api.put("/api/me/profile", { displayName: "Bob", avatar: PNG_1X1 });

    // Avatar alone: the nickname is untouched.
    const avatarOnly = (await (
      await api.put("/api/me/profile", { avatar: null })
    ).json()) as UpdateProfileResponse;
    expect(avatarOnly.user.displayName).toBe("Bob");
    expect(avatarOnly.user.avatarRev).toBeUndefined();

    const nameCleared = (await (
      await api.put("/api/me/profile", { displayName: null })
    ).json()) as UpdateProfileResponse;
    expect(nameCleared.user.displayName).toBeUndefined();
  });

  it("stores the nickname trimmed, and counts its length in characters", async () => {
    const bob = await provisionUser(t.app, "bob");
    const api = apiClient(t.app, bob.cookie);
    const padded = (await (
      await api.put("/api/me/profile", { displayName: "  Bob  " })
    ).json()) as UpdateProfileResponse;
    expect(padded.user.displayName).toBe("Bob");

    // 32 Chinese characters: 96 bytes in UTF-8, and accepted — the bound is on characters.
    const cjk = "名".repeat(32);
    const res = await api.put("/api/me/profile", { displayName: cjk });
    expect(res.status).toBe(200);
    expect(((await res.json()) as UpdateProfileResponse).user.displayName).toBe(cjk);
  });

  it("rejects a nickname that is empty, too long, or carries a control character", async () => {
    const bob = await provisionUser(t.app, "bob");
    const api = apiClient(t.app, bob.cookie);

    // Blank is not "clear" — null is. A field the user emptied is caught by the client, which
    // sends null; a blank string reaching here is a caller that did not.
    const blank = await api.put("/api/me/profile", { displayName: "   " });
    expect(blank.status).toBe(400);
    expect((await errorOf(blank)).message).toMatch(/displayName must be 1 to 32 characters/);

    const long = await api.put("/api/me/profile", { displayName: "x".repeat(33) });
    expect(long.status).toBe(400);
    expect((await errorOf(long)).message).toMatch(/displayName must be 1 to 32 characters/);

    // A pasted two-line value: the newline survives trim(), which only takes the ends.
    const control = await api.put("/api/me/profile", { displayName: "Bob\nLoblaw" });
    expect(control.status).toBe(400);
    expect((await errorOf(control)).message).toMatch(/control characters/);

    // Nothing was stored by any of the three.
    const me = (await (await api.get("/api/me")).json()) as MeResponse;
    expect(me.user.displayName).toBeUndefined();
  });

  it("rejects an avatar that is not an image data URL, and one over the cap", async () => {
    const bob = await provisionUser(t.app, "bob");
    const api = apiClient(t.app, bob.cookie);

    const svg = await api.put("/api/me/profile", {
      avatar: "data:image/svg+xml;base64,PHN2Zy8+",
    });
    expect(svg.status).toBe(400);
    expect((await errorOf(svg)).message).toMatch(/image\/png, image\/jpeg or image\/webp/);

    // Well-formed prefix, undecodable payload: a length of 1 mod 4 is not base64.
    const truncated = await api.put("/api/me/profile", { avatar: "data:image/png;base64,A" });
    expect(truncated.status).toBe(400);
    expect((await errorOf(truncated)).message).toMatch(/valid base64/);

    const oversize = await api.put("/api/me/profile", {
      avatar: `data:image/png;base64,${"A".repeat(AVATAR_MAX_CHARS)}`,
    });
    expect(oversize.status).toBe(400);
    expect((await errorOf(oversize)).message).toMatch(/at most 131072 characters/);

    const me = (await (await api.get("/api/me")).json()) as MeResponse;
    expect(me.user.avatarRev).toBeUndefined();
  });

  it("rejects a body naming neither field", async () => {
    const bob = await provisionUser(t.app, "bob");
    const res = await apiClient(t.app, bob.cookie).put("/api/me/profile", { nickname: "Bob" });
    expect(res.status).toBe(400);
    expect((await errorOf(res)).message).toMatch(/must name displayName or avatar/);
  });

  it("shows an admin the nicknames of the accounts they manage, but not their avatars", async () => {
    const bob = await provisionUser(t.app, "bob");
    await apiClient(t.app, bob.cookie).put("/api/me/profile", {
      displayName: "Bob Loblaw",
      avatar: PNG_1X1,
    });
    const admin = await loginAdmin(t.app);
    const list = (await (await apiClient(t.app, admin.cookie).get("/api/admin/users")).json()) as {
      users: { userId: string; displayName?: string; avatar?: string; avatarRev?: string }[];
    };
    const row = list.users.find((u) => u.userId === "bob");
    expect(row?.displayName).toBe("Bob Loblaw");
    // The table shows only the nickname, and the image is served to its own account alone.
    expect(row?.avatar).toBeUndefined();
    expect(row?.avatarRev).toBeUndefined();
    expect(list.users.find((u) => u.userId === "admin")?.displayName).toBeUndefined();
  });
});

describe("PUT /api/me/profile in desktop mode", () => {
  let t: TestApp;

  beforeEach(async () => {
    t = await createDesktopApp();
  });
  afterEach(async () => {
    await t.cleanup();
  });

  /**
   * Deliberately NOT the password route's gate, which the shell's window fails: a profile is
   * the account's own display data and needs no old password to check against. The shell's
   * window is the only session some desktop installs ever have, so gating it out would put the
   * Profile page behind a login that install does not have.
   */
  it("accepts the desktop shell's own token session", async () => {
    const cookie = await desktopLoginCookie(t.app);
    const res = await apiClient(t.app, cookie).put("/api/me/profile", { displayName: "Penguin" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as UpdateProfileResponse).user.displayName).toBe("Penguin");
  });
});
