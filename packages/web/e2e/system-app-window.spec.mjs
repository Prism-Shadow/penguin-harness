/**
 * A server module's iframe system app in the App Center's window, end to end against a real
 * server (locale en).
 *
 * No module on this line contributes one yet, so the spec answers GET /api/contributions itself, on
 * the page's API socket: the server's own answer plus one page, "Reports", drawn by an iframe and carrying `app`, and one
 * start-page count naming it. It also serves the page's document: a small app that says where it
 * is inside itself and what its root carries (language, Project), moves inside itself with links
 * (posting `penguin:location`), and asks the host to go to the Agents page (`penguin:navigate`).
 *
 * - The tile opens the window; a move inside the page replaces the address's `at`; minimize keeps
 *   the page's state and its tile brings it back where it was.
 * - The page's own old address under its path opens the window at that place.
 * - A move of the host's address (a link to the window at another place, then Back) reaches the
 *   page as a message, with no reload.
 * - `penguin:navigate` goes to the Agents page with the window minimized; Back brings it back.
 * - Full screen draws the same page at its place; the exit ball returns to the window there.
 */
import { test, expect } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";
import { setAccountPrefs } from "./account-prefs.mjs";
import { watchSocket } from "./api-socket.mjs";

const BASE = process.env.BASE_URL;
const U = `sysapp_${Date.now().toString(36)}`;
const P = "password123";
const SRC = "/api/reports-app/ui/index.html";
const KEY = "system_agent/reports";

const PAGE = {
  id: "reports.page",
  from: "ReportsModule",
  key: "reports",
  path: "/reports",
  nav: "none",
  admin: false,
  renderer: { iframe: { src: SRC, namespace: "reports" } },
  title: "Reports",
  titleZh: "报表",
  icon: "barChart",
  app: { order: 60 },
};
const METRIC = {
  id: "reports.count",
  key: "reports",
  title: "Reports",
  titleZh: "报表",
  icon: "barChart",
  order: 10,
  value: 7,
  app: "reports",
};

/** The page's document: where it is, what its root carries, and a counter that survives minimize. */
const DOCUMENT = `<!doctype html><html><head><meta charset="utf-8"><title>Reports</title>
<style>
  body { font-family: var(--wb-font, system-ui, sans-serif); color: var(--wb-fg, #222); margin: 0; padding: 28px; }
  h1 { font-size: 1.25rem; margin: 0 0 4px; }
  p { margin: 4px 0; color: var(--wb-muted, #666); }
  nav { display: flex; gap: 12px; margin: 16px 0; }
  a, button { color: var(--wb-accent, #0969da); font: inherit; background: none; border: 0; padding: 0; cursor: pointer; }
</style></head><body>
<h1 id="where"></h1>
<p id="context"></p>
<p>Clicks: <span id="clicks">0</span></p>
<nav>
  <a href="#" data-to="/">All reports</a>
  <a href="#" data-to="/r1?tab=a">Report r1</a>
  <a href="#" data-to="/r2">Report r2</a>
  <button id="agents" type="button">Go to Agents</button>
  <button id="link" type="button">Link to r2</button>
  <button id="count" type="button">Count</button>
</nav>
<script>
  let at = location.hash.slice(1) || "/";
  const where = document.getElementById("where");
  const show = () => { where.textContent = "At " + at; };
  show();
  const context = () => {
    const root = document.documentElement;
    document.getElementById("context").textContent =
      "lang " + (root.lang || "-") + ", project " + (root.dataset.projectId || "-");
  };
  context();
  new MutationObserver(context).observe(document.documentElement, { attributes: true });
  for (const link of document.querySelectorAll("[data-to]"))
    link.addEventListener("click", (e) => {
      e.preventDefault();
      at = link.dataset.to;
      show();
      parent.postMessage({ type: "penguin:location", at }, location.origin);
    });
  document.getElementById("agents").addEventListener("click", () =>
    parent.postMessage({ type: "penguin:navigate", to: "/agents" }, location.origin));
  // A link to this app's own window at another place: the host's address moves, not the page.
  document.getElementById("link").addEventListener("click", () =>
    parent.postMessage({ type: "penguin:navigate", to: "/apps?app=system_agent%2Freports&at=%2Fr2" }, location.origin));
  let clicks = 0;
  document.getElementById("count").addEventListener("click", () => {
    document.getElementById("clicks").textContent = String(++clicks);
  });
  addEventListener("message", (e) => {
    if (e.source !== parent || e.data?.type !== "penguin:location") return;
    at = e.data.at;
    show();
  });
</script></body></html>`;

const windowAt = (at) =>
  `/apps?${new URLSearchParams({ app: KEY, ...(at !== undefined ? { at } : {}) })}`;
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const atUrl = (at) => new RegExp(`${escape(windowAt(at))}$`);

test.beforeEach(async ({ page }) => {
  await provisionAndLogin(page.request, U, P);
  await setAccountPrefs(page.request, { lang: "en" });
  await page.setViewportSize({ width: 1280, height: 800 });
  // The API rides the page's socket (api-socket.mjs): the contributions are answered there, the
  // server's own answer with the fixture page and count added.
  const answer = await (await page.request.get(`${BASE}/api/contributions`)).json();
  const socket = await watchSocket(page);
  socket.answer("GET", "/api/contributions", {
    status: 200,
    body: {
      ...answer,
      pages: [...answer.pages, PAGE],
      startMetrics: [...(answer.startMetrics ?? []), METRIC],
    },
  });
  // The frame's document is a plain HTTP request.
  await page.route(`**${SRC}`, (route) =>
    route.fulfill({ contentType: "text/html", body: DOCUMENT }),
  );
});

const tileOf = (page) =>
  page.getByRole("list", { name: "App Center" }).getByRole("button", { name: /^Reports, / });
const windowOf = (page) => page.getByRole("region", { name: "Reports" });
const frameOf = (page) => page.frameLocator('section[aria-label="Reports"] iframe');

test("the tile opens the window, the page's place is in the address, and minimize keeps it", async ({
  page,
}) => {
  await page.goto(`${BASE}/apps`);
  await tileOf(page).click();
  await expect(page).toHaveURL(atUrl());
  const app = frameOf(page);
  await expect(app.locator("#where")).toHaveText("At /");
  await expect(app.locator("#context")).toHaveText(/^lang en, project \S+$/);

  await app.getByText("Report r1").click();
  await expect(page).toHaveURL(atUrl("/r1?tab=a"));
  await app.getByRole("button", { name: "Count" }).click();
  await app.getByRole("button", { name: "Count" }).click();

  await page
    .getByRole("navigation", { name: "Open pages" })
    .getByRole("button", { name: "Reports", exact: true })
    .hover();
  await page.getByRole("button", { name: "Page actions · Reports", exact: true }).click();
  await page.getByRole("menuitem", { name: "Minimize", exact: true }).click();
  await expect(page).toHaveURL(/\/apps$/);
  await expect(tileOf(page)).toHaveAccessibleName("Reports, system app, Running");

  // Brought back by its tile: the same page, its state kept, at the place it was.
  await tileOf(page).click();
  await expect(page).toHaveURL(atUrl("/r1?tab=a"));
  await expect(app.locator("#clicks")).toHaveText("2");
  await expect(app.locator("#where")).toHaveText("At /r1?tab=a");

  // The host's address moves (a link to another place, then Back): the page follows each move by
  // message, never reloading, so its count stays.
  await app.getByRole("button", { name: "Link to r2" }).click();
  await expect(page).toHaveURL(atUrl("/r2"));
  await expect(app.locator("#where")).toHaveText("At /r2");
  await page.goBack();
  await expect(page).toHaveURL(atUrl("/r1?tab=a"));
  await expect(app.locator("#where")).toHaveText("At /r1?tab=a");
  await expect(app.locator("#clicks")).toHaveText("2");
});

test("the page's old address opens the window at that place", async ({ page }) => {
  await page.goto(`${BASE}/reports/r1?tab=a`);
  await expect(page).toHaveURL(atUrl("/r1?tab=a"));
  await expect(frameOf(page).locator("#where")).toHaveText("At /r1?tab=a");
});

test("the page takes the viewer to the Agents page, and Back brings the window back", async ({
  page,
}) => {
  await page.goto(`${BASE}/apps`);
  await tileOf(page).click();
  const app = frameOf(page);
  await app.getByRole("button", { name: "Count" }).click();
  await app.getByRole("button", { name: "Go to Agents" }).click();
  await expect(page).toHaveURL(/\/agents$/);
  await expect(windowOf(page)).toBeHidden();

  await page.goBack();
  await expect(page).toHaveURL(atUrl());
  await expect(app.locator("#clicks")).toHaveText("1");
});

test("full screen draws the same page at its place, and its exit returns to the window there", async ({
  page,
}) => {
  await page.goto(`${BASE}/apps`);
  await tileOf(page).click();
  await frameOf(page).getByText("Report r2").click();
  await expect(page).toHaveURL(atUrl("/r2"));

  await page
    .getByRole("navigation", { name: "Open pages" })
    .getByRole("button", { name: "Reports", exact: true })
    .hover();
  await page.getByRole("button", { name: "Page actions · Reports", exact: true }).click();
  await page.getByRole("menuitem", { name: "Open full screen", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/[^/]+\/system_agent\/reports\?at=%2Fr2$/);
  const full = page.frameLocator('iframe[title="Reports"]');
  await expect(full.locator("#where")).toHaveText("At /r2");
  await full.getByText("Report r1").click();
  await expect(page).toHaveURL(/\/app\/[^/]+\/system_agent\/reports\?at=%2Fr1%3Ftab%3Da$/);

  await page.getByRole("button", { name: "Exit full screen" }).click();
  await expect(page).toHaveURL(atUrl("/r1?tab=a"));
  await expect(frameOf(page).locator("#where")).toHaveText("At /r1?tab=a");
});

test("a new chat omits project counts even when a module contributes a metric", async ({
  page,
}) => {
  await page.goto(`${BASE}/chat/new`);
  await expect(page.locator("[data-slot=brand]")).toBeVisible();
  await expect(page.locator("[data-slot=count]")).toHaveCount(0);
});

test("the Apps directory restores a contributed system frame and removes its row on close", async ({
  page,
}) => {
  await page.goto("/apps");
  const apps = page
    .getByRole("navigation", { name: "Apps", exact: true })
    .getByRole("list", { name: "Apps", exact: true });
  const row = apps.locator('[data-app-row="system_agent/reports"]');
  await expect(row).toHaveCount(0);
  await tileOf(page).click();
  await expect(row).toHaveCount(1);
  await frameOf(page).getByRole("button", { name: "Count" }).click();
  await row.hover();
  await apps
    .getByRole("listitem")
    .filter({ has: page.locator('[data-app-row="system_agent/reports"]') })
    .getByRole("button", { name: "More actions", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "Minimize", exact: true }).click();
  await expect(row).toHaveCount(1);
  await row.click();
  await expect(frameOf(page).locator("#clicks")).toHaveText("1");
  await row.hover();
  await apps
    .getByRole("listitem")
    .filter({ has: page.locator('[data-app-row="system_agent/reports"]') })
    .getByRole("button", { name: "More actions", exact: true })
    .click();
  await page.getByRole("menuitem", { name: "Close", exact: true }).click();
  await expect(row).toHaveCount(0);
  await expect(tileOf(page)).toBeVisible();
});
