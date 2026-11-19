// Page transitions on a live app.
//
// - Given a transition under way, a second sidebar click and Back still reach the requested page,
//   the shell stays the same live elements, and with reduced motion (the system's or the app's)
//   a navigation starts no transition.
// - Given a draft, sending its first message and opening a new chat stay on the chat page, so
//   neither starts a transition; leaving for another page does.
// - Given each theme, a page change starts a transition in Console and Doodle, and none in Primer
//   or Frost, whose page change is instant.
// - Given a theme that animates a page change, switching the Agent settings tabs and the Plugins
//   tab's sub-pages starts none: a tab is part of its page, and only a page change moves.
import { expect, test } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";

const BASE = process.env.BASE_URL;
const MOCK = process.env.MOCK_URL;
const nav = (page, href) => page.locator(`.ui-shell [data-slot="nav"] a[href="${href}"]`).first();

/** Counts the view transitions the page starts, from before the app loads. */
async function countTransitions(page) {
  await page.addInitScript(() => {
    window.startedTransitions = 0;
    const start = document.startViewTransition?.bind(document);
    if (!start) return;
    document.startViewTransition = (...args) => {
      window.startedTransitions++;
      return start(...args);
    };
  });
  return () => page.evaluate(() => window.startedTransitions);
}

test("page transitions leave the navigation live and respect reduced motion", async ({ page }) => {
  await provisionAndLogin(page.request, "navmotion", "password123");
  await page.request.put("/api/me/prefs", {
    data: { themeId: "geek", initialPasswordBannerDismissed: true },
  });
  // Not a draft: with no model configured, the draft page opens a dialog over the sidebar.
  await page.goto("/models");
  const agents = nav(page, "/agents");
  const models = nav(page, "/models");
  await expect(agents).toBeVisible();
  // Hold the transition long enough to interact during it, independent of machine speed.
  await page.addStyleTag({ content: ":root { --ui-page-duration: 1s !important; }" });
  await page.evaluate(() => {
    window.firstNavigation = document.querySelector('.ui-shell [data-slot="nav"]');
    window.firstViewport = document.querySelector("[data-page-viewport]");
  });
  await agents.click();
  await expect(page).toHaveURL(/\/agents$/);
  await expect
    .poll(() =>
      page.evaluate(() =>
        document.getAnimations().some(
          // Console animates the outgoing picture (its dissolve), so either picture counts.
          (animation) =>
            animation.effect?.pseudoElement === "::view-transition-old(penguin-page)" ||
            animation.effect?.pseudoElement === "::view-transition-new(penguin-page)",
        ),
      ),
    )
    .toBe(true);
  // The next real click can reach the sidebar before the currently moving picture finishes.
  await models.click();
  await expect(page).toHaveURL(/\/models$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/agents$/);
  await expect(agents).toHaveAttribute("aria-current", "page");
  expect(
    await page.evaluate(
      () =>
        window.firstNavigation === document.querySelector('.ui-shell [data-slot="nav"]') &&
        window.firstViewport === document.querySelector("[data-page-viewport]"),
    ),
  ).toBe(true);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.matches(":active-view-transition")))
    .toBe(false);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(() => {
    window.startedTransitions = 0;
    const start = document.startViewTransition.bind(document);
    document.startViewTransition = (...args) => {
      window.startedTransitions++;
      return start(...args);
    };
  });
  await models.click();
  await expect(models).toHaveAttribute("aria-current", "page");
  expect(await page.evaluate(() => window.startedTransitions)).toBe(0);

  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.evaluate(() => {
    document.documentElement.dataset.motion = "reduced";
  });
  await agents.click();
  await expect(agents).toHaveAttribute("aria-current", "page");
  expect(await page.evaluate(() => window.startedTransitions)).toBe(0);
});

test("sending from a draft and opening a new chat stay on one page, so nothing transitions", async ({
  page,
}) => {
  await provisionAndLogin(page.request, "navsend", "password123");
  await page.request.put("/api/me/prefs", {
    data: { themeId: "geek", initialPasswordBannerDismissed: true },
  });
  const projects = await (await page.request.get(`${BASE}/api/projects`)).json();
  const projectId = projects.projects[0].projectId;
  const models = await page.request.put(`${BASE}/api/projects/${projectId}/models`, {
    data: {
      defaultModel: { provider: "custom", modelId: "claude-4-8" },
      models: [
        {
          provider: "custom",
          modelId: "claude-4-8",
          apiKey: "sk-mock",
          baseUrl: MOCK,
          contextWindow: 200000,
        },
      ],
    },
  });
  expect(models.ok(), "put models").toBeTruthy();
  const started = await countTransitions(page);

  await page.goto("/chat/new");
  const composer = page.getByPlaceholder(/输入消息/);
  await composer.fill("hello from a draft");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await expect(page).toHaveURL(/\/chat\/session-/, { timeout: 15_000 });
  await expect(page.getByText("hello from a draft").first()).toBeVisible();
  expect(await started()).toBe(0);

  await page.getByRole("button", { name: "新建对话" }).first().click();
  await expect(page).toHaveURL(/\/chat\/new$/);
  expect(await started()).toBe(0);

  // A real page change from the same place does start one, so the zeros above are not a
  // transition that could never start.
  await nav(page, "/agents").click();
  await expect(page).toHaveURL(/\/agents$/);
  await expect.poll(started).toBe(1);
});

test("a page change transitions in Console and Doodle, and not in Primer or Frost", async ({
  page,
}) => {
  await provisionAndLogin(page.request, "navthemes", "password123");
  const started = await countTransitions(page);
  for (const [themeId, transitions] of [
    ["geek", 1],
    ["doodle", 1],
    ["github", 0],
    ["modern", 0],
  ]) {
    await page.request.put("/api/me/prefs", {
      data: { themeId, initialPasswordBannerDismissed: true },
    });
    await page.goto("/agents");
    await expect(page.locator("html")).toHaveAttribute("data-theme", themeId);
    const models = nav(page, "/models");
    await expect(models).toBeVisible();
    await models.click();
    await expect(models).toHaveAttribute("aria-current", "page");
    await expect.poll(started, { message: themeId }).toBe(transitions);
  }
});

test("switching Agent settings tabs and Plugins sub-pages starts no transition", async ({
  page,
}) => {
  await provisionAndLogin(page.request, "navtabs", "password123");
  await page.request.put("/api/me/prefs", {
    data: { themeId: "geek", initialPasswordBannerDismissed: true },
  });
  const started = await countTransitions(page);
  await page.goto("/agents/default_agent");
  const tab = (name) => page.getByRole("tab", { name, exact: true });
  await expect(tab("概览")).toHaveAttribute("aria-selected", "true");
  for (const name of [
    "系统提示词",
    "运行参数",
    "工具",
    "记忆",
    "密钥保险柜",
    "定时任务",
    "API",
    "插件",
  ]) {
    await tab(name).click();
    await expect(tab(name)).toHaveAttribute("aria-selected", "true");
  }
  const subPages = page.getByRole("group", { name: "插件的子页面" });
  for (const name of ["技能", "钩子", "工作台", "插件"]) {
    await subPages.getByRole("button", { name, exact: true }).click();
    await expect(subPages.getByRole("button", { name, exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  }
  expect(await started()).toBe(0);

  // Leaving for another page from the same place does start one, so the zero above is not a
  // transition that could never start.
  await nav(page, "/models").click();
  await expect(page).toHaveURL(/\/models$/);
  await expect.poll(started).toBe(1);
});
