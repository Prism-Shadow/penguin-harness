import { expect, test } from "@playwright/test";
import { ADMIN_ID, ADMIN_PASSWORD, login } from "./auth.mjs";
import { setAccountPrefs } from "./account-prefs.mjs";

const kinds = ["workspace", "terminal", "builtin-browser"];
const mark = (root, kind) => root.locator('[data-system-app-icon="session-tools-' + kind + '"]');

for (const [name, width, themeId, themeMode] of [
  ["desktop", 1280, "modern", "dark"],
  ["phone", 375, "doodle", "light"],
]) {
  test.describe(name, () => {
    test.use({ viewport: { width, height: 800 }, hasTouch: name === "phone" });

    test("the three session tools retain their distinct app marks across launch surfaces", async ({
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
        contextWindow: 200000,
      };
      await expect(
        await page.request.put(project + "/models", {
          data: { defaultModel: model, models: [model] },
        }),
      ).toBeOK();
      await page.goto("/apps");
      const catalog = page.locator('[data-workspace-page="catalog"]:visible');
      const marks = new Map();
      for (const kind of kinds) {
        const tile = mark(catalog, kind);
        await expect(tile).toBeVisible();
        marks.set(kind, await tile.locator("svg").innerHTML());
      }
      expect(new Set(marks.values()).size).toBe(kinds.length);
      const ids = [];
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
          if (name === "phone")
            await page
              .getByRole("banner")
              .getByRole("button", { name: /^Sessions/ })
              .click();
          await page
            .locator('[data-session-id="' + id + '"]:visible')
            .first()
            .click();
        }
        const shortcuts = page.getByRole("button", { name: "Shortcuts", exact: true });
        await shortcuts.click();
        for (const kind of kinds) {
          const entry = page.getByTestId("dock-launcher-open-" + kind);
          await expect(mark(entry, kind)).toBeVisible();
          expect(await mark(entry, kind).locator("svg").innerHTML()).toBe(marks.get(kind));
        }
        if (id === ids[0]) {
          await page.getByTestId("dock-launcher-open-app-center").click();
          for (const kind of kinds) {
            await expect(mark(catalog, kind)).toBeVisible();
            expect(await mark(catalog, kind).locator("svg").innerHTML()).toBe(marks.get(kind));
          }
          await page.getByRole("button", { name: "Close panel: App Center", exact: true }).click();
          await shortcuts.click();
        }
        const terminal = page.getByTestId("dock-launcher-open-terminal");
        if (name === "phone") await terminal.tap();
        else await terminal.click();
        const tab = page.locator(
          '[data-testid="dock-tab"][data-tab-id^=":app:session-tool/terminal"]:visible',
        );
        await expect(mark(tab, "terminal")).toBeVisible();
      }
      if (name === "phone")
        await page
          .getByRole("banner")
          .getByRole("button", { name: /^Sessions/ })
          .click();
      const running = page.getByRole("navigation", { name: "Apps", exact: true });
      await expect(mark(running, "terminal")).toHaveCount(2);
      for (const row of await mark(running, "terminal").all()) {
        expect(await row.locator("svg").innerHTML()).toBe(marks.get("terminal"));
      }
    });
  });
}
