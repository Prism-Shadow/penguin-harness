import { test, expect } from "@playwright/test";
import { ADMIN_ID, ADMIN_PASSWORD, login } from "./auth.mjs";
import { setAccountPrefs } from "./account-prefs.mjs";
import { watchSocket } from "./api-socket.mjs";

const reply = (body) => ({ status: 200, body });

test("names keep their own line and plugin counts lead to the right Agent inventory", async ({
  page,
}) => {
  await login(page.request, ADMIN_ID, ADMIN_PASSWORD);
  await setAccountPrefs(page.request, { lang: "en" });
  const project = "/api/projects/default_project";
  const inventory = await page.request.post(project + "/agents", {
    data: {
      agentId: "card_inventory",
      name: "Inventory reviewer",
      defaultPlugins: false,
      plugins: ["agent-development", "data-analysis"],
    },
  });
  await expect(inventory).toBeOK();
  const actual = await (await page.request.get(project + "/agents")).json();
  const ordinary = actual.agents.find((a) => a.agentId === "default_agent");
  const system = actual.agents.find((a) => a.system);
  const counted = actual.agents.find((a) => a.agentId === "card_inventory");
  expect(system).toBeTruthy();
  const socket = await watchSocket(page);
  const machineId = "lab";
  const alias = "Remote-Laboratory-" + "Research".repeat(8);
  const name = "超长智能体名称 ".repeat(3) + "Research Assistant";
  const agentId = "research_" + "archive_".repeat(7) + "analysis";
  socket.answer(
    "GET",
    project + "/machines",
    reply({
      machines: [
        {
          id: "ssh:" + alias,
          alias,
          member: true,
          local: false,
          machineId,
          installed: { version: "1", at: "2026-01-01" },
          connection: { pid: 21 },
          socket: null,
          api: null,
          status: null,
          root: "/tmp",
        },
      ],
      imageVersion: "1",
      job: null,
      jobs: [],
    }),
  );
  const remote = { ...ordinary, agentId, name, skillCount: 3 };
  delete remote.pluginCount;
  socket.answer("GET", "/server/" + machineId + project + "/agents", reply({ agents: [remote] }));
  await page.goto("/agents");
  const card = page
    .locator("[data-agent-card]")
    .filter({ has: page.getByRole("link", { name, exact: true }) });
  await expect(card).toBeVisible();
  for (const width of [1280, 390, 320]) {
    await page.setViewportSize({ width, height: 820 });
    const layout = await card.evaluate((el) => {
      const title = el.querySelector("a").getBoundingClientRect();
      const row = el.querySelector("a").parentElement.getBoundingClientRect();
      const meta = el.querySelector("span[title]").getBoundingClientRect();
      return {
        nameBottom: title.bottom,
        secondaryTop: meta.top,
        nameWidth: title.width,
        rowWidth: row.width,
        right: el.getBoundingClientRect().right,
        viewport: innerWidth,
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    expect(layout.secondaryTop).toBeGreaterThanOrEqual(layout.nameBottom);
    expect(layout.nameWidth).toBeGreaterThan(Math.min(layout.rowWidth - 32, 190));
    expect(layout.right).toBeLessThanOrEqual(layout.viewport);
    expect(layout.overflow).toBe(false);
  }
  await expect(
    card.getByRole("button", { name: "Plugin count unavailable from this server" }),
  ).toBeVisible();
  await expect(card.getByRole("button", { name: "3 skills" })).toBeVisible();
  const owner = page
    .locator("[data-agent-card]")
    .filter({ has: page.getByRole("link", { name: "System", exact: true }) });
  const count = system.pluginCount;
  expect(Number.isInteger(count)).toBe(true);
  await owner
    .getByRole("button", { name: count === 1 ? "1 plugin" : count + " plugins", exact: true })
    .click();
  await expect(page).toHaveURL(/\/agents\/system_agent\?tab=plugins$/);
  await expect(
    page.getByRole("button", { name: /uninstall|install plugin|update plugin/i }),
  ).toHaveCount(0);
  await page.goBack();
  const local = page
    .locator("[data-agent-card]")
    .filter({ has: page.getByRole("link", { name: "Inventory reviewer", exact: true }) });
  expect(counted.pluginCount).toBe(2);
  expect(counted.skillCount).toBeGreaterThan(2);
  const plugins = local.getByRole("button", { name: "2 plugins", exact: true });
  await expect(plugins.locator("xpath=following-sibling::*[1]")).toHaveAttribute(
    "aria-label",
    counted.skillCount + " skills",
  );
  await plugins.click();
  await expect(page).toHaveURL(/\/agents\/card_inventory\?tab=plugins$/);
  await expect(page.getByRole("list", { name: /Installed/i }).getByRole("listitem")).toHaveCount(2);
});
