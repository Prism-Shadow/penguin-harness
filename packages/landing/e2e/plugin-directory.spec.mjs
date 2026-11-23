import { expect, test } from "@playwright/test";

const carousel = '[data-part="carousel"]';
const cards = ".showcase-grid .showcase-card";

test("opens and changes the featured plugin while its directory and artwork are still loading", async ({
  page,
}) => {
  let releaseDirectory;
  const pendingDirectory = new Promise((resolve) => {
    releaseDirectory = resolve;
  });
  let releasePictures;
  const pendingPictures = new Promise((resolve) => {
    releasePictures = resolve;
  });
  await page.route(/plugin-directory[^/]*\.json(?:\?|$)/, async (route) => {
    await pendingDirectory;
    await route.continue();
  });
  await page.route(/\.webp(?:\?|$)/, async (route) => {
    await pendingPictures;
    await route.abort();
  });
  try {
    await page.goto("/plugins/", { waitUntil: "domcontentloaded" });
    const feature = page.locator(carousel);
    const title = feature.getByRole("heading");
    await expect(title).toBeVisible();
    await expect(page.getByRole("searchbox")).toHaveCount(0);
    const first = await title.innerText();
    await feature.getByRole("button", { name: /next|下一/i }).click();
    await expect(title).not.toHaveText(first);
    releasePictures();
    await expect(feature.locator('[data-part="cover"]')).toHaveAttribute("data-state", "generated");
  } finally {
    releasePictures();
    releaseDirectory();
  }
  await expect(page.getByRole("searchbox")).toBeVisible();
});

for (const [locale, width] of [
  ["en", 1366],
  ["zh", 390],
]) {
  test(`the ${locale} directory can filter and open plugins beyond the first group`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript((locale) => localStorage.setItem("penguin-site.lang", locale), locale);
    await page.goto("/plugins/");
    await expect(page.getByRole("searchbox")).toBeVisible();
    const group = page.locator(cards);
    await expect(group).toHaveCount(6);
    const more = page
      .getByRole("button", { name: locale === "en" ? "More" : "更多", exact: true })
      .last();
    await more.scrollIntoViewIfNeeded();
    await expect.poll(() => group.count()).toBeGreaterThan(6);
    const query = page.getByRole("searchbox");
    await query.fill("sandbox-wsl");
    await expect(group).toHaveCount(1);
    const link = group.locator('a[href$="/plugins/sandbox-wsl"]');
    await expect(link).toBeVisible();
    await page
      .locator('button[aria-pressed="false"]')
      .filter({ hasText: /sandbox|沙箱/i })
      .first()
      .click();
    await expect(group).toHaveCount(1);
    const filtered = page.url();
    await link.click();
    await expect(page).toHaveURL(/\/plugins\/sandbox-wsl$/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.goBack();
    await expect(query).toHaveValue("sandbox-wsl");
    await expect(group).toHaveCount(1);
    await page.goto(filtered);
    await expect(group).toHaveCount(1);
    await expect(query).toHaveValue("sandbox-wsl");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
}

test("Back restores a card reached after several groups", async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 800 });
  await page.goto("/plugins/");
  const group = page.locator(cards);
  await expect(group.first()).toBeVisible();
  while ((await group.count()) < 18) {
    const count = await group.count();
    await group.last().scrollIntoViewIfNeeded();
    await page.locator(".showcase-grid + button").scrollIntoViewIfNeeded();
    await expect.poll(() => group.count()).toBeGreaterThan(count);
  }
  const chosen = group.nth(15).getByRole("link");
  await chosen.scrollIntoViewIfNeeded();
  const scroll = await page.evaluate(() => scrollY);
  expect(scroll).toBeGreaterThan(800);
  await chosen.click();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.goBack();
  await expect(chosen).toBeInViewport();
  await expect.poll(() => page.evaluate(() => scrollY)).toBeCloseTo(scroll, -1);
});

for (const recovery of ["retry", "revisit"]) {
  test(`recovers the full directory after a failed request by ${recovery}`, async ({ page }) => {
    let fail = true;
    await page.addInitScript(() => localStorage.setItem("penguin-site.lang", "en"));
    await page.route(/plugin-directory[^/]*\.json(?:\?|$)/, (route) =>
      fail ? route.fulfill({ status: 503, body: "Temporarily unavailable" }) : route.continue(),
    );
    await page.goto("/plugins/");
    await expect(page.getByText("The plugin directory could not be loaded.")).toBeVisible();
    await expect(page.locator(carousel).getByRole("heading")).toBeVisible();
    fail = false;
    if (recovery === "retry") {
      await page.getByRole("button", { name: "Retry" }).click();
    } else {
      await page.locator(carousel).getByRole("link").last().click();
      await expect(page).toHaveURL(/\/plugins\/[^/]+$/);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByRole("button", { name: "Retry" })).toHaveCount(0);
      await page.goBack();
    }
    await page.getByRole("searchbox").fill("sandbox-wsl");
    await expect(page.locator(cards)).toHaveCount(1);
    await expect(page.locator(cards).getByRole("link")).toHaveAttribute(
      "href",
      "/plugins/sandbox-wsl",
    );
  });
}
