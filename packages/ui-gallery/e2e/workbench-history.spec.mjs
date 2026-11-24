import { expect, test } from "@playwright/test";

test("Support restores both bundled pages and keeps the same question when reopened", async ({
  page,
}) => {
  await page.goto("app.html?route=%2Fchat%2Fnew&embed=1&fresh=1&lang=en&theme=modern");
  await page
    .getByRole("link", { name: /^App Center(?: ·|$)/ })
    .first()
    .click();
  const open = () => page.locator('li[data-app="penguin_support/support"] > button').click();
  const history = async () => {
    await page.getByRole("button", { name: /More.*Support/i }).click();
    await page.getByRole("menuitem", { name: /Version history/i }).click();
    return page.getByRole("dialog");
  };
  const content = page.locator('iframe[src*="/workbenches/support/ui/"]:visible');
  const question = /Where can I find an earlier conversation/;
  const early = "2026.10.14.3";
  const restore = async (revision) => {
    const list = await history();
    await list
      .getByRole("listitem")
      .filter({ hasText: revision })
      .first()
      .getByRole("button", { name: "Restore" })
      .click();
    await page
      .getByRole("dialog", { name: "Restore version" })
      .getByRole("button", { name: "Restore" })
      .click();
  };
  await open();
  await expect(content.contentFrame().getByText(question)).toBeVisible();
  await expect(content.contentFrame().locator("#live")).toHaveCount(1);
  const list = await history();
  await expect(list.getByRole("listitem")).toHaveCount(2);
  const current = await list.getByRole("listitem").first().locator(".font-mono").innerText();
  await list.getByRole("button", { name: "Close" }).click();
  await restore(early);
  await expect(content).toHaveAttribute("src", /history-2026\.10\.14\.3\.html/);
  await content.contentFrame().getByText(question).click();
  await expect(content.contentFrame().getByText(/Select its workspace/)).toBeVisible();
  await expect(content.contentFrame().locator("#live")).toHaveCount(0);
  await content.contentFrame().getByRole("button", { name: "Close" }).click();
  await page.getByRole("button", { name: "Close", exact: true }).last().click();
  await open();
  await expect(content).toHaveAttribute("src", /history-2026\.10\.14\.3\.html/);
  await restore(current);
  await expect(content.contentFrame().locator("#live")).toHaveCount(1);
  await expect(content.contentFrame().getByText(question)).toBeVisible();
});
