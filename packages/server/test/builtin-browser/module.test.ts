/**
 * The agent browser assembled in the real platform tree: a plain server has no shell to reach
 * and offers every signed-in user their own Chrome instead, a desktop-mode server reaches the
 * (fake) shell on its port, the admin's event stream hears the tabs, the CLI's admin token is
 * let in, and disposing the App — what a hot swap does to the old generation — takes the
 * browser's listener off the port.
 */
import { describe, expect, it } from "vitest";
import type { BuiltinBrowserStatus } from "../../src/api/types.js";
import { userChannelKey } from "../../src/http/routes/events.js";
import {
  apiClient,
  createDesktopApp,
  createTestApp,
  desktopLoginCookie,
  loginAdmin,
  provisionUser,
} from "../helpers.js";
import { FakeShell, tab } from "./fake-shell.js";

async function until(ready: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 500; i++) {
    if (ready()) return;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  throw new Error(`timed out waiting for ${what}`);
}

describe("the built-in browser in the platform tree", () => {
  it("offers only Chrome on a plain server, to the admin and a member alike", async () => {
    const t = await createTestApp();
    try {
      const unpaired: BuiltinBrowserStatus = {
        available: false,
        reason: "extension_not_paired",
        backend: "chrome",
        backends: [{ backend: "chrome", available: false, reason: "extension_not_paired" }],
        tabs: [],
        activeTabId: null,
      };
      const admin = await loginAdmin(t.app);
      const res = await apiClient(t.app, admin.cookie).get("/api/builtin-browser/status");
      expect(res.status).toBe(200);
      expect((await res.json()) as BuiltinBrowserStatus).toEqual(unpaired);
      const bob = await provisionUser(t.app, "bob");
      const own = await apiClient(t.app, bob.cookie).get("/api/builtin-browser/status");
      expect(own.status).toBe(200);
      expect((await own.json()) as BuiltinBrowserStatus).toEqual(unpaired);
    } finally {
      await t.cleanup();
    }
  });

  it("reaches the shell in desktop mode and tells the admin's event stream about tabs", async () => {
    const shell = new FakeShell();
    shell.guests.set(3, tab(3));
    const t = await createDesktopApp({ browserShellPort: shell.port });
    try {
      const cookie = await desktopLoginCookie(t.app);
      const events: { type: string; tabs?: { title: string }[] }[] = [];
      t.deps.channels
        .get(userChannelKey("admin"))
        .subscribe((evt) => events.push(JSON.parse(evt.data)));

      const status = await apiClient(t.app, cookie).get("/api/builtin-browser/status");
      expect((await status.json()) as BuiltinBrowserStatus).toEqual({
        available: true,
        backend: "builtin",
        backends: [
          { backend: "builtin", available: true },
          { backend: "chrome", available: false, reason: "extension_not_paired" },
        ],
        tabs: [tab(3)],
        activeTabId: 3,
      });
      shell.show(tab(3, { title: "Renamed" }));
      await until(
        () =>
          events.some((e) => e.type === "builtin_browser_tabs" && e.tabs?.[0]?.title === "Renamed"),
        "the tabs event",
      );
    } finally {
      await t.cleanup();
    }
  });

  it("lets an Agent's CLI in with the admin's local API token", async () => {
    const shell = new FakeShell();
    const t = await createDesktopApp({ browserShellPort: shell.port });
    try {
      const token = t.deps.authService.localApiToken();
      expect(token).not.toBeNull();
      const res = await t.app.request("/api/builtin-browser/tabs", {
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ tabs: [], activeTabId: null });
    } finally {
      await t.cleanup();
    }
  });

  it("takes its listener off the port when the App is disposed", async () => {
    const shell = new FakeShell();
    const t = await createDesktopApp({ browserShellPort: shell.port });
    expect(shell.port.listenerCount).toBe(1);
    await t.cleanup();
    expect(shell.port.listenerCount).toBe(0);
  });
});
