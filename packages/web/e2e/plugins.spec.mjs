/**
 * End-to-end test for the plugin surface — this revision's headline (locale zh-CN), covering
 * the two files of `packages/web/src/features/plugins/`: `plugins-page.tsx` (the Plugins page,
 * one list of the library's installed rows and the registry's available rows) and
 * `plugin-detail-page.tsx` (one registry entry's own page).
 *
 * Written against the server's payloads, not against a rendered shell: every expected name,
 * count and body below is read from the same API the page reads —
 * `GET /api/plugins` (the library), `GET /api/plugins/registry` (the index),
 * `GET /api/projects/:projectId/plugins/installed` (what the Project asks for) — and the install
 * control is asserted twice over: the call it makes (method, path, JSON body) and the server
 * state it leaves behind (`GET .../agents/:agentId/skills`). A page that mounts but never gets
 * its data fails on the count, the cards, the registry rows, the call or the convergence.
 *
 * The call is read off whichever transport carries it (PRFC-0011): while the page's API socket
 * is open, `apiFetch` sends it as a `{ id, call: { method, path, body } }` frame on that socket
 * rather than as an HTTP request, so the spec records both — see {@link recordApiCalls}.
 *
 * Deliberately not measured here: a module plugin's own install/uninstall (POST/DELETE
 * `/api/projects/:projectId/plugins/installed` behind the `安装 <specifier>？` confirmation).
 * The e2e environment answers `shipped: []` for that Project — the four sandbox backends the
 * index lists are not resolvable from the temp data root — so the page offers those rows while
 * the server refuses the write (`plugin_not_shipped`). Asserting it would pin this harness's
 * packaging, not the page.
 */
import { test, expect } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";

const BASE = process.env.BASE_URL;
const U = "pluginsuser";
const P = "password123";
/** The blank Agent the install flow targets: default_agent preinstalls most of the library. */
const TARGET = "plugin_target";

/** An Agent's installed skill names, sorted — the server's answer, not the page's. */
async function agentSkills(request, projectId, agentId) {
  const res = await request.get(`${BASE}/api/projects/${projectId}/agents/${agentId}/skills`);
  expect(res.ok(), "read the Agent's installed skills").toBeTruthy();
  return (await res.json()).skills.map((s) => s.name).sort();
}

/**
 * Every API call the page makes, reported to `listener` as `{ method, path, body }` whichever
 * transport carried it: an HTTP request, or a call frame the page sent on its API socket. The
 * path drops the query string; `body` is the parsed JSON body, undefined when there is none.
 * Register it before the page navigates — the socket opens with the page.
 */
function recordApiCalls(page, listener) {
  page.on("request", (r) => {
    const path = new URL(r.url()).pathname;
    if (!path.startsWith("/api/")) return;
    let body;
    try {
      body = r.postDataJSON() ?? undefined;
    } catch {
      body = undefined;
    }
    listener({ method: r.method(), path, body });
  });
  page.on("websocket", (ws) => {
    ws.on("framesent", ({ payload }) => {
      if (typeof payload !== "string") return;
      let frame;
      try {
        frame = JSON.parse(payload);
      } catch {
        return;
      }
      const call = frame?.call;
      if (!call || typeof call.path !== "string") return;
      listener({ method: call.method, path: call.path.split("?")[0], body: call.body });
    });
  });
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The specifiers the "可安装" list must hold, computed the way the page computes them
 * (`availablePluginRows`): the index entries this Project does not ask for, then what the build
 * ships and the index does not know.
 */
function availableFromPayloads(index, deployment) {
  const listed = new Set(
    deployment.plugins.filter((p) => p.everywhere !== false).map((p) => p.specifier),
  );
  const names = [];
  const seen = new Set();
  for (const entry of index) {
    if (listed.has(entry.name) || seen.has(entry.name)) continue;
    seen.add(entry.name);
    names.push(entry.name);
  }
  for (const name of deployment.shipped) {
    if (listed.has(name) || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

test("plugins: the Plugins page renders the library and index the server serves, and installing one on an Agent sends the install request the server applies", async ({
  page,
}) => {
  // The page's API calls, on either transport; the install and uninstall assertions read them.
  const apiCalls = [];
  recordApiCalls(page, (call) => apiCalls.push(call));

  await provisionAndLogin(page.request, U, P);
  const projects = await (await page.request.get(`${BASE}/api/projects`)).json();
  const projectId = projects.projects[0].projectId;

  // The payloads the page is built from, read here first so every assertion below is tied to
  // them: nothing in this test is a hardcoded plugin name or count.
  const library = await (await page.request.get(`${BASE}/api/plugins`)).json();
  const plugins = library.groups.flatMap((g) => g.plugins);
  expect(plugins.length, "the library this build ships").toBeGreaterThan(0);
  const index = (await (await page.request.get(`${BASE}/api/plugins/registry`)).json()).plugins;
  const deployment = await (
    await page.request.get(`${BASE}/api/projects/${projectId}/plugins/installed`)
  ).json();
  const available = availableFromPayloads(index, deployment);

  // A blank Agent, and the premise the convergence assertions rest on: it holds nothing.
  const created = await page.request.post(`${BASE}/api/projects/${projectId}/agents`, {
    data: { agentId: TARGET, name: "Plugin Target" },
  });
  expect([200, 201, 409], "create the install target Agent").toContain(created.status());
  expect(await agentSkills(page.request, projectId, TARGET), "the target starts empty").toEqual([]);

  // —— The page, reached through its own navigation entry ——
  await page.goto(`${BASE}/chat`);
  await page.getByRole("link", { name: "插件市场" }).click();
  await expect(page).toHaveURL(/\/plugins$/);
  await expect(page.getByRole("heading", { level: 1, name: "插件" })).toBeVisible();

  // "已安装的插件 (N)": N is the library the server answered with — a count that does not come
  // from the request cannot be this one. Folded on entry, then unfolded to put the cards in view.
  // The trailing " (" separates the section header from the filter column's "已安装" chip.
  const installedHeader = page.getByRole("button", { name: /^已安装的插件 \(/ });
  await expect(installedHeader).toContainText(`已安装的插件 (${plugins.length})`);
  await expect(installedHeader).toHaveAttribute("aria-expanded", "false");
  await installedHeader.click();
  await expect(installedHeader).toHaveAttribute("aria-expanded", "true");
  for (const plugin of plugins) {
    await expect(page.getByText(plugin.name, { exact: true }).first()).toBeVisible();
  }

  // "可安装 (N)": the registry entries this Project does not ask for yet — the second list's
  // whole membership, so a broken index fetch leaves it empty and fails here.
  if (available.length > 0) {
    const availableHeader = page.getByRole("button", { name: /^可安装 \(/ });
    await expect(availableHeader).toContainText(`可安装 (${available.length})`);
    for (const name of available) {
      await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
    }
  } else {
    await expect(page.getByRole("button", { name: /^可安装 \(/ })).toHaveCount(0);
  }

  // —— The control: "管理安装 <plugin>" -> "安装 <agent>" -> the call it makes ——
  // A plugin that ships a skill: installing it installs every one of them.
  const plugin =
    plugins.find((p) => p.skills.length > 0 && p.hooks.length === 0) ??
    plugins.find((p) => p.skills.length > 0);
  expect(plugin, "a library plugin that ships a skill").toBeDefined();
  const expectedSkills = plugin.skills.map((s) => s.name).sort();

  await page.getByRole("button", { name: `管理安装 ${plugin.name}` }).click();
  const manage = page.getByRole("dialog", { name: `管理安装：${plugin.name}` });
  await expect(manage).toBeVisible();
  const installRow = manage.getByRole("button", { name: `安装 ${TARGET}`, exact: true });
  await expect(installRow).toBeVisible();

  const installPath = `/api/projects/${projectId}/agents/${TARGET}/plugins`;
  const isInstall = (c) => c.method === "POST" && c.path === installPath;
  expect(apiCalls.filter(isInstall), "no install call before the click").toEqual([]);
  await installRow.click();
  await expect
    .poll(() => apiCalls.filter(isInstall).length, "the install control's call")
    .toBeGreaterThan(0);
  expect(apiCalls.find(isInstall).body, "the install control's request body").toEqual({
    names: [plugin.name],
  });

  // The same button turns into the installed face, whose accessible name is the uninstall action.
  const uninstallRow = manage.getByRole("button", { name: `卸载 ${TARGET}`, exact: true });
  await expect(uninstallRow).toBeVisible();
  await expect(uninstallRow).toContainText("已安装");
  // The server holds what the library says the plugin ships — and nothing besides.
  await expect
    .poll(() => agentSkills(page.request, projectId, TARGET))
    .toEqual(expectedSkills);

  // —— The other direction: uninstalling deletes files, so it confirms first ——
  const deletes = [];
  const sinceUninstall = apiCalls.length;
  await uninstallRow.click();
  const confirm = page.getByRole("dialog", { name: `卸载 ${plugin.name}` });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "卸载", exact: true }).click();
  await expect(manage.getByRole("button", { name: `安装 ${TARGET}`, exact: true })).toBeVisible();
  for (const c of apiCalls.slice(sinceUninstall)) if (c.method === "DELETE") deletes.push(c.path);
  for (const skill of expectedSkills) {
    expect(deletes, `the uninstall control deletes ${skill}`).toContain(
      `/api/projects/${projectId}/agents/${TARGET}/skills/${skill}`,
    );
  }
  await expect.poll(() => agentSkills(page.request, projectId, TARGET)).toEqual([]);

  // Escape closes the Modal (built into it), leaving no dialog behind.
  await page.keyboard.press("Escape");
  await expect(manage).toHaveCount(0);
});

test("plugins: a registry entry's detail page renders the index entry and the readme the server answers", async ({
  page,
}) => {
  await provisionAndLogin(page.request, U, P);
  const index = (await (await page.request.get(`${BASE}/api/plugins/registry`)).json()).plugins;
  expect(index.length, "the builtin registry this build embeds").toBeGreaterThan(0);
  const entry = index[0];
  const readme = (
    await (
      await page.request.get(
        `${BASE}/api/plugins/registry/readme?name=${encodeURIComponent(entry.name)}`,
      )
    ).json()
  ).readme;

  // The available row's own link is the way in — the splat route the manifest declares.
  await page.goto(`${BASE}/plugins`);
  await page.getByRole("link", { name: new RegExp(escapeRe(entry.name)) }).first().click();
  await expect(page).toHaveURL(new RegExp(`/plugins/registry/${escapeRe(entry.name)}$`));

  // The header and the metadata table are the index entry, field for field.
  await expect(page.getByRole("heading", { level: 1, name: entry.name })).toBeVisible();
  await expect(page.getByText(`v${entry.version}`)).toBeVisible();
  await expect(page.getByText(entry.description)).toBeVisible();
  await expect(page.getByText(entry.license)).toBeVisible();

  // The readme is a second call, and the page renders what it answered: the package's README.md
  // when the machine has it, the "no readme" line when it does not.
  if (readme === null) {
    await expect(page.getByText("该插件暂无说明文档。")).toBeVisible();
  } else {
    const heading = readme
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.startsWith("#"));
    expect(heading, "the readme the server served carries a heading").toBeDefined();
    await expect(
      page.getByText(heading.replace(/^#+\s*/, ""), { exact: false }).first(),
    ).toBeVisible();
  }
});
