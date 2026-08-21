/**
 * Desktop mode: one-shot desktop-login, Bearer-token shutdown, desktopMode in /api/me,
 * the desktop-session password change without oldPassword, and the single-user guard
 * closing the user-management and Project-member surfaces.
 */
import { describe, expect, it } from "vitest";
import {
  apiClient,
  createDesktopApp,
  desktopLoginCookie,
  createTestApp,
  loginAdmin,
  TEST_DESKTOP_TOKEN,
} from "./helpers.js";
import type { ErrorBody, MeResponse } from "../src/api/types.js";

describe("desktop-login", () => {
  it("redeems the token once: cookie session, redirect to /, second attempt 401", async () => {
    const t = await createDesktopApp();
    try {
      const res = await t.app.request(`/api/auth/desktop-login?token=${TEST_DESKTOP_TOKEN}`);
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/");
      const cookie = res.headers.get("set-cookie");
      expect(cookie).toContain("penguin_session=");

      const me = await t.app.request("/api/me", {
        headers: { cookie: cookie!.split(";")[0]! },
      });
      expect(me.status).toBe(200);
      const body = (await me.json()) as MeResponse;
      expect(body.user.userId).toBe("admin");
      expect(body.desktopMode).toBe(true);

      const replay = await t.app.request(`/api/auth/desktop-login?token=${TEST_DESKTOP_TOKEN}`);
      expect(replay.status).toBe(401);
    } finally {
      await t.cleanup();
    }
  });

  it("rejects a wrong or missing token without consuming the real one", async () => {
    const t = await createDesktopApp();
    try {
      expect((await t.app.request("/api/auth/desktop-login?token=wrong")).status).toBe(401);
      expect((await t.app.request("/api/auth/desktop-login")).status).toBe(401);
      // The real token still works after failed attempts.
      expect(
        (await t.app.request(`/api/auth/desktop-login?token=${TEST_DESKTOP_TOKEN}`)).status,
      ).toBe(302);
    } finally {
      await t.cleanup();
    }
  });

  it("is 404 outside desktop mode, and /api/me reports desktopMode false", async () => {
    const t = await createTestApp();
    try {
      expect((await t.app.request("/api/auth/desktop-login?token=x")).status).toBe(404);
      const admin = await loginAdmin(t.app);
      const me = await apiClient(t.app, admin.cookie).get("/api/me");
      expect(((await me.json()) as MeResponse).desktopMode).toBe(false);
    } finally {
      await t.cleanup();
    }
  });
});

describe("desktop shutdown endpoint", () => {
  it("accepts the Bearer token repeatedly and triggers the registered handler", async () => {
    const t = await createDesktopApp();
    try {
      let requested = 0;
      t.deps.desktop!.onShutdownRequest(() => {
        requested += 1;
      });
      const res = await t.app.request("/api/desktop/shutdown", {
        method: "POST",
        headers: { authorization: `Bearer ${TEST_DESKTOP_TOKEN}` },
      });
      expect(res.status).toBe(202);
      // The route defers the trigger so the 202 can flush first.
      await new Promise((r) => setTimeout(r, 80));
      expect(requested).toBe(1);

      // Unlike the login token, the shutdown credential is NOT one-shot.
      const again = await t.app.request("/api/desktop/shutdown", {
        method: "POST",
        headers: { authorization: `Bearer ${TEST_DESKTOP_TOKEN}` },
      });
      expect(again.status).toBe(202);
    } finally {
      await t.cleanup();
    }
  });

  it("rejects wrong or missing tokens, and does not exist outside desktop mode", async () => {
    const t = await createDesktopApp();
    try {
      const wrong = await t.app.request("/api/desktop/shutdown", {
        method: "POST",
        headers: { authorization: "Bearer nope" },
      });
      expect(wrong.status).toBe(401);
      const missing = await t.app.request("/api/desktop/shutdown", { method: "POST" });
      expect(missing.status).toBe(401);
    } finally {
      await t.cleanup();
    }

    const plain = await createTestApp();
    try {
      // Outside desktop mode the route is not mounted; the request falls through to the
      // cookie auth middleware, which rejects the cookieless caller with 401.
      const res = await plain.app.request("/api/desktop/shutdown", {
        method: "POST",
        headers: { authorization: `Bearer ${TEST_DESKTOP_TOKEN}` },
      });
      expect(res.status).toBe(401);
    } finally {
      await plain.cleanup();
    }
  });
});

describe("desktop single-user mode", () => {
  async function expectSingleUser403(res: Response): Promise<void> {
    expect(res.status).toBe(403);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe("desktop_single_user");
  }

  it("rejects the whole admin-users surface with desktop_single_user", async () => {
    const t = await createDesktopApp();
    try {
      // The seeded admin signed in through the regular login form: even a fully
      // authorized admin session gets the dedicated 403, not admin_required.
      const admin = await loginAdmin(t.app);
      const api = apiClient(t.app, admin.cookie);
      await expectSingleUser403(await api.get("/api/admin/users"));
      await expectSingleUser403(
        await api.post("/api/admin/users", { userId: "eve", password: "password-123" }),
      );
      await expectSingleUser403(
        await api.post("/api/admin/users/admin/password", { password: "password-456" }),
      );
      await expectSingleUser403(
        await t.app.request("/api/admin/users/eve", {
          method: "DELETE",
          headers: { cookie: admin.cookie },
        }),
      );
      // No user was created by the rejected POST.
      expect(t.deps.db.prepare("SELECT COUNT(*) AS n FROM users").get()?.n).toBe(1);
    } finally {
      await t.cleanup();
    }
  });

  it("rejects Project member management (reads and writes) with desktop_single_user", async () => {
    const t = await createDesktopApp();
    try {
      const admin = await loginAdmin(t.app);
      const api = apiClient(t.app, admin.cookie);
      await expectSingleUser403(await api.get("/api/projects/default_project/members"));
      await expectSingleUser403(
        await api.post("/api/projects/default_project/members", { userId: "eve" }),
      );
      await expectSingleUser403(
        await t.app.request("/api/projects/default_project/members/eve", {
          method: "DELETE",
          headers: { cookie: admin.cookie },
        }),
      );
    } finally {
      await t.cleanup();
    }
  });

  it("leaves both surfaces working on a normal multi-user server", async () => {
    const t = await createTestApp();
    try {
      const admin = await loginAdmin(t.app);
      const api = apiClient(t.app, admin.cookie);
      const users = await api.get("/api/admin/users");
      expect(users.status).toBe(200);
      const members = await api.get("/api/projects/default_project/members");
      expect(members.status).toBe(200);
    } finally {
      await t.cleanup();
    }
  });
});

describe("desktop-session password change", () => {
  it("allows omitting oldPassword for a desktop session and clears the initial flag", async () => {
    const t = await createDesktopApp();
    try {
      const cookie = await desktopLoginCookie(t.app);
      const res = await apiClient(t.app, cookie).put("/api/me/password", {
        newPassword: "brand-new-password",
      });
      expect(res.status).toBe(204);
      const me = (await (await apiClient(t.app, cookie).get("/api/me")).json()) as MeResponse;
      expect(me.user.passwordIsInitial).toBe(false);
    } finally {
      await t.cleanup();
    }
  });

  it("still validates oldPassword when it is provided by a desktop session", async () => {
    const t = await createDesktopApp();
    try {
      const cookie = await desktopLoginCookie(t.app);
      const res = await apiClient(t.app, cookie).put("/api/me/password", {
        oldPassword: "wrong-password",
        newPassword: "brand-new-password",
      });
      expect(res.status).toBe(400);
    } finally {
      await t.cleanup();
    }
  });

  it("keeps requiring oldPassword for password-established sessions in desktop mode", async () => {
    const t = await createDesktopApp();
    try {
      // Sign in via the regular login form against the same desktop-mode server.
      const admin = await loginAdmin(t.app);
      const res = await apiClient(t.app, admin.cookie).put("/api/me/password", {
        newPassword: "brand-new-password",
      });
      expect(res.status).toBe(400);
    } finally {
      await t.cleanup();
    }
  });
});
