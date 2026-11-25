import { expect, test } from "@playwright/test";
import { shellFor } from "../scripts/route-shell.mjs";

const heading = (page) => page.getByRole("heading", { level: 1 });

async function checkPage(page, pathname, directoryTitle) {
  if (!directoryTitle) {
    const listPath = "/" + pathname.split("/")[1];
    await expect(page.locator(`main a[href="${listPath}"]`).first()).toBeVisible();
  }
  await expect(heading(page)).toBeVisible();
  const name = directoryTitle ?? (await heading(page).innerText()).trim();
  const title = `${name} | PenguinHarness`;
  const canonical = `https://penguin.ooo${pathname.replace(/\/?$/, "/")}`;
  const description = await page.locator('meta[name="description"]').getAttribute("content");
  expect(description).toBeTruthy();
  await expect(page).toHaveTitle(title);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", canonical);
  for (const [field, value] of Object.entries({ title, description, url: canonical })) {
    await expect(page.locator(`meta[property="og:${field}"]`)).toHaveAttribute("content", value);
    await expect(page.locator(`meta[name="twitter:${field}"]`)).toHaveAttribute("content", value);
  }
}

for (const path of ["/plugins", "/benchmarks", "/blog"]) {
  test(`${path} detail metadata follows navigation, history and language`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    const home = await page.title();
    const directory = page.locator(`a[href="${path}"]:visible`).first();
    await directory.click();
    const links = page.locator(`main a[href^="${path}/"]:visible`);
    await expect(links.first()).toBeVisible();
    const firstPath = await links.first().getAttribute("href");
    await links.first().click();
    await checkPage(page, firstPath);
    await page.getByRole("button", { name: "Language", exact: true }).click();
    await page.getByRole("menuitemradio", { name: "中文", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");
    await checkPage(page, firstPath);

    await page.goBack();
    await checkPage(
      page,
      path,
      { "/plugins": "插件", "/benchmarks": "评估集", "/blog": "博客" }[path],
    );
    // Multiple directory cards can link to the same featured plugin.
    const second = page
      .locator(`main a[href^="${path}/"]:not([href="${firstPath}"]):visible`)
      .first();
    await expect(second).toBeVisible();
    const secondPath = await second.getAttribute("href");
    await second.click();
    await checkPage(page, secondPath);
    await page.goBack();
    await page.goForward();
    await checkPage(page, secondPath);
    await page.goto(secondPath + "?source=share#top");
    await checkPage(page, secondPath);
    await page.locator('nav a[href="/"]:visible').first().click();
    await expect(page).toHaveTitle(home);
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
      "content",
      "https://penguin.ooo/",
    );
  });
}

test("leaving a direct share before the lazy page mounts restores the homepage title", async ({
  page,
}) => {
  const home = "PenguinHarness - Open RSI Framework for Enterprise AI Apps";
  await page.route("**/amsp/", async (route) => {
    const response = await route.fetch();
    const body = shellFor(await response.text(), "https://penguin.ooo/amsp/", {
      title: "AMSP: Agent Message Stream Protocol",
      description: "The agent stream protocol",
      image: "https://penguin.ooo/og-amsp.png",
      imageAlt: "AMSP",
    });
    await route.fulfill({ response, body });
  });
  let release;
  const hold = new Promise((resolve) => {
    release = resolve;
  });
  await page.route("**/pages/amsp.tsx*", async (route) => {
    await hold;
    await route.continue();
  });
  try {
    await page.goto("/amsp/", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveTitle("AMSP: Agent Message Stream Protocol");
    await page.locator('nav a[href="/"]:visible').first().click();
    await expect(heading(page)).toBeVisible();
    await expect(page).toHaveTitle(home);
    for (const selector of ['meta[property="og:title"]', 'meta[name="twitter:title"]'])
      await expect(page.locator(selector)).toHaveAttribute("content", home);
  } finally {
    release();
  }
});
