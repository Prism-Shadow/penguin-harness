import { expect, test } from "@playwright/test";
import { ADMIN_ID, ADMIN_PASSWORD, login } from "./auth.mjs";
import { setAccountPrefs } from "./account-prefs.mjs";

const catalogKinds = ["terminal", "builtin-browser"];
const kinds = ["workspace", ...catalogKinds, "agents", "trace", "memory"];
const line = (root) => root.locator("svg.ui-glyph > [data-set=line]");
const mark = (root, kind) => root.locator('[data-system-app-icon="session-tools-' + kind + '"]');

for (const [name, width, themeId, themeMode] of [
  ["desktop", 1280, "modern", "dark"],
  ["phone", 375, "doodle", "light"],
]) {
  test.describe(name, () => {
    test.use({ viewport: { width, height: 800 }, hasTouch: name === "phone" });

    test("session shortcuts, add menus and tabs share the theme glyph while app entries retain their own marks", async ({
      page,
    }) => {
      await login(page.request, ADMIN_ID, ADMIN_PASSWORD);
      await setAccountPrefs(page.request, { lang: "en", themeId, themeMode });
      const { projects } = await (await page.request.get("/api/projects")).json();
      const project = "/api/projects/" + projects[0].projectId;
      const model = {
        provider: "custom",
        modelId: "claude-4-8",
        baseUrl: process.env.MOCK_URL,
        apiKey: "sk-test",
        contextWindow: 1000000,
      };
      await expect(
        await page.request.put(project + "/models", {
          data: { defaultModel: model, models: [model] },
        }),
      ).toBeOK();
      await page.goto("/apps");
      const catalog = page.locator('[data-workspace-page="catalog"]:visible');
      const marks = new Map();
      const shortcutsByKind = new Map();
      for (const kind of catalogKinds) {
        const tile = mark(catalog, kind);
        await expect(tile).toBeVisible();
        marks.set(kind, await tile.locator("svg").innerHTML());
      }
      const filesTile = catalog.locator('li[data-app="system_agent/session-tools-workspace"]');
      await expect(filesTile).toHaveCount(0);
      const ids = [];
      const drawer = page.getByRole("banner").getByRole("button", { name: /^Sessions/ });
      for (let i = 0; i < 2; i++) {
        const created = await page.request.post(project + "/agents/default_agent/sessions", {
          data: {},
        });
        await expect(created).toBeOK();
        ids.push((await created.json()).session.sessionId);
      }
      for (const id of ids) {
        // Use the workspace row for an in-app navigation so the first running tool stays mounted.
        if (id === ids[0]) await page.goto("/chat/" + id);
        else {
          if (name === "phone") await drawer.click();
          await page
            .locator('[data-session-id="' + id + '"]:visible')
            .first()
            .click();
        }
        const shortcuts = page.getByRole("button", { name: "Shortcuts", exact: true });
        await shortcuts.click();
        for (const kind of kinds) {
          const entry = page.getByTestId("dock-launcher-open-" + kind);
          await expect(entry.locator("svg.ui-glyph").first()).toHaveAttribute(
            "viewBox",
            "0 0 24 24",
          );
          const glyph = await line(entry).innerHTML();
          if (shortcutsByKind.has(kind)) expect(glyph).toBe(shortcutsByKind.get(kind));
          else shortcutsByKind.set(kind, glyph);
        }
        expect(new Set(shortcutsByKind.values()).size).toBe(kinds.length);
        if (id === ids[0]) {
          await page.getByTestId("dock-launcher-open-app-center").click();
          for (const kind of catalogKinds) {
            await expect(mark(catalog, kind)).toBeVisible();
            expect(await mark(catalog, kind).locator("svg").innerHTML()).toBe(marks.get(kind));
          }
          await expect(filesTile).toHaveCount(0);
          const closeCatalog = page.getByRole("button", {
            name: "Close panel: App Center",
            exact: true,
          });
          const dock = page.getByTestId("dock").filter({ has: closeCatalog });
          await dock.getByTestId("dock-add").click();
          for (const kind of kinds) {
            const entry = page.getByTestId("dock-add-" + kind);
            await expect(entry).toBeVisible();
            expect(await line(entry).innerHTML()).toBe(shortcutsByKind.get(kind));
          }
          await page.keyboard.press("Escape");
          await closeCatalog.click();
          await shortcuts.click();
        }
        const terminal = page.getByTestId("dock-launcher-open-terminal");
        if (name === "phone") await terminal.tap();
        else await terminal.click();
        const tab = page.locator(
          '[data-testid="dock-tab"][data-tab-id^=":app:session-tool/terminal"]:visible',
        );
        await expect(tab).toBeVisible();
        expect(await line(tab).first().innerHTML()).toBe(shortcutsByKind.get("terminal"));
      }
      if (name === "phone") await drawer.click();
      const running = page.getByRole("navigation", { name: "Apps", exact: true });
      await expect(mark(running, "terminal")).toHaveCount(0);
      await page.getByRole("link", { name: /^App Center(?: ·|$)/ }).click();
      await catalog
        .locator('li[data-app="system_agent/session-tools-terminal"] > button')
        .first()
        .click();
      await expect(
        page.getByRole("searchbox", { name: "Search Sessions with open terminals" }),
      ).toBeVisible();
      if (name === "phone") await drawer.click();
      const terminalMark = mark(running, "terminal");
      await expect(terminalMark).toBeVisible();
      expect(await terminalMark.locator("svg").innerHTML()).toBe(marks.get("terminal"));
    });
  });
}
