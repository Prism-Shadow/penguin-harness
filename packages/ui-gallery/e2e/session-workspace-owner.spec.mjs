import { expect, test } from "@playwright/test";

for (const width of [1280, 390]) {
  test(`a conversation belongs to one workspace even when two machines use its path (${width}px)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 840 });
    await page.goto("app.html?route=%2Fchat%2Fs-hooks-index&lang=en&theme=modern");
    const composer = page.locator('[data-slot="composer"] textarea:visible');
    await expect(composer).toBeVisible();
    const workspaces = page.getByRole("button", { name: "Workspaces", exact: true });
    const openMenu = async () => {
      if (width < 600 && !(await workspaces.isVisible())) {
        await page
          .getByRole("banner")
          .getByRole("button", { name: /^Sessions/ })
          .click();
      }
      await expect(workspaces).toBeVisible();
    };
    await openMenu();
    await page.reload();
    await expect(composer).toBeVisible();
    await openMenu();
    const localRows = page.locator('button[data-session-id="s-hooks-index"]:visible');
    await expect(localRows).toHaveCount(1);
    const path = "/home/demo/projects/docs-expert";
    const remoteGroup = page
      .locator("button[aria-expanded]:visible")
      .filter({ hasText: "[SSH: gpu-box]" });
    await expect(remoteGroup).toHaveCount(0);
    const create = (owner) =>
      page.evaluate(
        async ({ owner, path }) => {
          const base = owner ? "/server/" + owner : "";
          const response = await fetch(base + "/api/projects/demo/agents/default_agent/sessions", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ workspace: path }),
          });
          if (!response.ok) throw new Error("Session creation failed: " + response.status);
          return (await response.json()).session.sessionId;
        },
        { owner, path },
      );
    const remoteId = await create("gpu-box-a8f3c2");
    const localId = await create(null);
    const row = (id) => page.locator('button[data-session-id="' + id + '"]:visible');
    await expect(remoteGroup).toHaveCount(1);
    await expect(remoteGroup).toContainText(/gpu-box\]\s*1$/);
    await expect(row(remoteId)).toHaveCount(1);
    await expect(row(localId)).toHaveCount(1);
    await row(remoteId).click();
    await expect(composer).toBeVisible();
    await openMenu();
    await expect(row(remoteId)).toHaveAttribute("aria-current", "page");
    await remoteGroup.click();
    await expect(remoteGroup).toHaveAttribute("aria-expanded", "false");
    await row(localId).click();
    await expect(composer).toBeVisible();
    await openMenu();
    await expect(row(localId)).toHaveAttribute("aria-current", "page");
    await expect(remoteGroup).toHaveAttribute("aria-expanded", "false");
    await remoteGroup.click();
    await expect(row(remoteId)).toBeVisible();
  });
}
