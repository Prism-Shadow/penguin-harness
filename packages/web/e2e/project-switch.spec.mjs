/**
 * Switching Projects: what one Project shows and asks for must never carry into another.
 *
 * - Given the current Project picked again from the switcher, its Agents and the draft page stay
 *   (the switch is a no-op; clearing the list there once left the sidebar empty for good). On the
 *   plugin library page, the newly current Project's install state replaces the previous one's
 *   even though both Projects have an Agent of the same id.
 * - Given Project A's Agent list answers late, after the user has switched to Project B, the
 *   Agents page shows only B's Agents — before and after A's answer lands — and no request
 *   names an Agent of A under B.
 * - Given a slow machine (renderer CPU throttled, every API answer delayed at random from a fixed
 *   seed) and a conversation of an A-only Agent open, when the user switches A→B→A→B with clicks
 *   landing mid-load, several times over, each Project settles on its own conversation and
 *   Agents, no request pairs a Project with an Agent of the other, and no `agent_not_found`
 *   (「该 Agent 已不存在。」) comes back. A new chat in B whose remembered draft names A's Agent
 *   (written while A's Agents were on screen) asks nothing about it either, and neither does the
 *   cost center opened on A's Agent (`/usage?agentId=`) once the user switches to B.
 *
 * A Project is created with a display name different from the username: a newly registered
 * user's initial Project is named after the user, and the account button at the sidebar's foot
 * shows the username too, so locating by name would match both.
 */
import { test, expect } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";

const BASE = process.env.BASE_URL;
const MOCK = process.env.MOCK_URL;
const P = "password123";

/** The mock model on a Project: one without credentials raises an onboarding overlay over every click. */
async function configureModels(request, projectId) {
  const put = await request.put(`${BASE}/api/projects/${projectId}/models`, {
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
  expect(put.ok(), `put models ${projectId}`).toBeTruthy();
}

/**
 * A user name for this test run: `--repeat-each` reruns a test against the same data root, where
 * the first run's Projects already exist, so each repetition provisions its own user.
 */
function userFor(base) {
  const index = test.info().repeatEachIndex;
  return index === 0 ? base : `${base}${index}`;
}

async function ok(res, what) {
  expect(res.ok(), `${what}: ${res.status()} ${await res.text()}`).toBeTruthy();
  return res.json();
}

/**
 * Two Projects of one user, each with an Agent the other does not have and a conversation on
 * it: A = the user's initial Project renamed "Alpha Project" with `alpha_only`, B = a new
 * "Beta Project" with `beta_only`. Returns each Project's full Agent set as the server lists it,
 * which is what the request watch below checks every request against.
 */
async function twoProjects(request, user) {
  await provisionAndLogin(request, user, P);
  const a = (await ok(await request.get(`${BASE}/api/projects`), "list projects")).projects[0]
    .projectId;
  await ok(
    await request.patch(`${BASE}/api/projects/${a}`, { data: { name: "Alpha Project" } }),
    "rename A",
  );
  // A non-admin's Project id must be prefixed with <username>-.
  const b = (
    await ok(
      await request.post(`${BASE}/api/projects`, {
        data: { projectId: `${user}-beta`, name: "Beta Project" },
      }),
      "create B",
    )
  ).project.projectId;
  const sessions = {};
  for (const [projectId, agentId, name] of [
    [a, "alpha_only", "Alpha Agent"],
    [b, "beta_only", "Beta Agent"],
  ]) {
    await configureModels(request, projectId);
    await ok(
      await request.post(`${BASE}/api/projects/${projectId}/agents`, { data: { agentId, name } }),
      `create ${agentId}`,
    );
    const created = await ok(
      await request.post(`${BASE}/api/projects/${projectId}/agents/${agentId}/sessions`, {
        data: { provider: "custom", modelId: "claude-4-8" },
      }),
      `session on ${agentId}`,
    );
    sessions[projectId] = created.session.sessionId;
  }
  const agentsOf = new Map();
  for (const projectId of [a, b]) {
    const listed = await ok(
      await request.get(`${BASE}/api/projects/${projectId}/agents`),
      `agents of ${projectId}`,
    );
    agentsOf.set(projectId, new Set(listed.agents.map((x) => x.agentId)));
  }
  return { a, b, sessions, agentsOf };
}

/**
 * Records every browser request that names an Agent under a Project that has no such Agent —
 * in the path (`/api/projects/:p/agents/:a/…`), in an `agentId` query, or in a session-list
 * batch body — and every answer that says `agent_not_found`. Requests about Projects outside
 * `agentsOf` are not judged.
 */
function watchProjectAgentPairs(page, agentsOf) {
  const bad = [];
  watched = bad;
  page.on("request", (req) => {
    const url = new URL(req.url());
    const parts = url.pathname.split("/").map((p) => decodeURIComponent(p));
    // ["", "api", "projects", projectId, kind, rest…]
    if (parts[1] !== "api" || parts[2] !== "projects" || parts[3] === undefined) return;
    const known = agentsOf.get(parts[3]);
    if (known === undefined) return;
    const named = [];
    if (parts[4] === "agents" && parts[5] !== undefined && parts[5] !== "") named.push(parts[5]);
    const queried = url.searchParams.get("agentId");
    if (queried) named.push(queried);
    if (parts[4] === "sessions" && parts[5] === "batch" && req.method() === "POST") {
      const body = JSON.parse(req.postData() ?? "{}");
      for (const r of body.requests ?? []) named.push(r.agentId);
    }
    for (const agentId of named) {
      if (!known.has(agentId)) {
        bad.push(`${req.method()} ${url.pathname}${url.search} names ${agentId} under ${parts[3]}`);
      }
    }
  });
  page.on("response", async (res) => {
    if (res.status() !== 404 || !res.url().includes("/api/")) return;
    const body = await res.text().catch(() => "");
    if (body.includes("agent_not_found")) {
      bad.push(`agent_not_found from ${res.request().method()} ${new URL(res.url()).pathname}`);
    }
  });
  return bad;
}

/** The running test's mismatched requests, printed when the test fails before it asserts them. */
let watched = null;
test.afterEach(async ({}, testInfo) => {
  if (watched !== null && watched.length > 0 && testInfo.status !== testInfo.expectedStatus) {
    console.log(`mismatched Project/Agent requests:\n${watched.join("\n")}`);
  }
  watched = null;
});

/** Deterministic PRNG (mulberry32): the same seed gives the same delays on every run. */
function seededRandom(seed) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Opens the switcher (its trigger reads the current Project's name) and picks `to`. The menu row
 * is the only button whose name starts with `to` while `from` is current. Retried, because a
 * render landing between the two clicks may close the menu on a throttled machine.
 */
async function switchProject(page, from, to) {
  await expect(async () => {
    const row = page.getByRole("button", { name: new RegExp(`^${to}`) });
    if (!(await row.first().isVisible())) {
      await page.getByRole("button", { name: from, exact: true }).click({ timeout: 2_000 });
    }
    await row.first().click({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
}

test("clicking the current Project in the dropdown: Agent and Session lists must not disappear", async ({
  page,
}) => {
  const U = userFor("projswitcher");
  const PROJ = "SwitchTarget";
  await provisionAndLogin(page.request, U, P);

  const initial = (await (await page.request.get(`${BASE}/api/projects`)).json()).projects[0];

  // A non-admin's Project id must be prefixed with <username>-.
  const created = await page.request.post(`${BASE}/api/projects`, {
    data: { projectId: `${U}-target`, name: PROJ },
  });
  expect(created.ok(), "create project").toBeTruthy();
  const projectId = (await created.json()).project.projectId;
  for (const id of [initial.projectId, projectId]) await configureModels(page.request, id);

  await page.goto("/");

  // First wait for the initial Project's sidebar to settle: during this time it fetches the
  // Agent list and lands on the draft page (the brand heading marks the draft page); operating
  // the dropdown midway through would get closed by a subsequent re-render.
  const generalAgent = page.getByText("General Agent").first();
  const draftTitle = page.getByRole("heading", { name: "PenguinHarness" });
  await expect(generalAgent).toBeVisible();
  await expect(draftTitle).toBeVisible();

  // Switch to this newly created Project (a different id: takes the normal switch path).
  const byName = page.getByRole("button", { name: PROJ });
  await page.getByRole("button", { name: U }).first().click(); // the initial Project's display name defaults to the username
  await byName.first().click();

  // Wait for the new Project's sidebar to settle too (Agent list + draft page).
  await expect(generalAgent).toBeVisible();
  await expect(draftTitle).toBeVisible();

  // The key action: click this "currently selected" Project again in the dropdown.
  await byName.first().click(); // the top trigger button (currently displaying PROJ)
  await expect(byName).toHaveCount(2); // the trigger button + the same-named item in the menu
  await byName.nth(1).click();

  // The regression point: both the Agent and the draft page are still there (before the fix,
  // these two assertions would fail — the sidebar gets cleared and stuck in loading).
  await expect(generalAgent).toBeVisible();
  await expect(draftTitle).toBeVisible();

  // —— Regression (#74 comment): switching Project on the plugin library page must not leave
  // installation state from the previous Project —— both Projects' default_agent share the same
  // id (agentId is the page state table's key): first uninstall the Default RSI Toolkit's one
  // skill from the current (target) Project via the API, then switch over from the initial
  // Project's plugin library page — before the fix, the old Project's snapshot would overwrite
  // the freshly fetched data, so "Manage installation" would always show "Installed."
  const del = await page.request.delete(
    `${BASE}/api/projects/${projectId}/agents/default_agent/skills/agent-optimization`,
  );
  expect(del.ok(), "uninstall agent-optimization on target project").toBeTruthy();

  // Switch back to the initial Project, populating the plugin library page's snapshot (default_agent has everything preinstalled -> Installed).
  await byName.first().click();
  await page.getByRole("button", { name: U }).first().click();
  await expect(generalAgent).toBeVisible();
  await page.getByRole("link", { name: "插件市场" }).click();
  await expect(page).toHaveURL(/\/plugins$/);
  // The category sections are open on entry. agent-optimization is the Default RSI Toolkit's
  // only skill.
  await page.getByRole("button", { name: "管理安装 default-rsi-toolkit" }).click();
  await expect(page.getByRole("button", { name: "卸载 default_agent" })).toBeVisible();
  await page.keyboard.press("Escape");

  // Staying on the plugin library page while switching to target: the same-named default_agent's state must flip to "Install" (not installed).
  await page.getByRole("button", { name: U }).first().click();
  await byName.first().click();
  await page.getByRole("button", { name: "管理安装 default-rsi-toolkit" }).click();
  await expect(page.getByRole("button", { name: "安装 default_agent" })).toBeVisible();
  await page.keyboard.press("Escape");
});

/**
 * These tests observe HTTP requests (`page.route`, `waitForResponse`/`waitForRequest`); the API
 * socket would carry those calls as frames, invisible to Playwright. Leave the page on the HTTP
 * transport the assertions are written for.
 */
async function useHttpTransport(page) {
  await page.addInitScript(() => {
    Object.defineProperty(window, "WebSocket", { value: undefined, configurable: true });
  });
}

test("a late Agent list of the Project just left never shows under the new one", async ({
  page,
}) => {
  const { a, agentsOf } = await twoProjects(page.request, userFor("projlate"));
  const bad = watchProjectAgentPairs(page, agentsOf);
  await useHttpTransport(page);
  await page.addInitScript((projectId) => {
    localStorage.setItem("penguin.lastProjectId", projectId);
  }, a);

  // A's first Agent list is held back until after the switch to B has been answered.
  let held = true;
  await page.route(
    (url) => url.pathname === `/api/projects/${a}/agents`,
    async (route) => {
      if (held) {
        held = false;
        await new Promise((resolve) => setTimeout(resolve, 3_000));
      }
      await route.continue();
    },
  );
  const lateAnswer = page.waitForResponse(
    (res) => new URL(res.url()).pathname === `/api/projects/${a}/agents`,
  );

  await page.goto("/agents");
  await switchProject(page, "Alpha Project", "Beta Project");
  const main = page.getByRole("main");
  await expect(main.getByText("Beta Agent", { exact: true })).toBeVisible();

  // A's answer lands now, after B's: it must change nothing on screen.
  await lateAnswer;
  await page.waitForTimeout(1_500);
  await expect(main.getByText("Beta Agent", { exact: true })).toBeVisible();
  await expect(main.getByText("Alpha Agent", { exact: true })).toHaveCount(0);
  expect(bad).toEqual([]);
});

test("on a slow machine, quick Project switches keep each Project's Agents and conversation apart", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const user = userFor("projslow");
  const { a, b, sessions, agentsOf } = await twoProjects(page.request, user);
  const bad = watchProjectAgentPairs(page, agentsOf);
  await useHttpTransport(page);
  await page.addInitScript(
    ({ a, b, user }) => {
      localStorage.setItem("penguin.lastProjectId", a);
      // B's new-chat draft remembers A's Agent, as one written while A's Agents leaked into B.
      localStorage.setItem(
        `penguin.chatDraft.${user}.${b}`,
        JSON.stringify({ agentId: "alpha_only" }),
      );
    },
    { a, b, user },
  );

  // A slow machine: renders and effects lag behind the network, and every API answer arrives
  // 100–800 ms late, in an order the seed fixes, so lists of the two Projects cross in flight.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 6 });
  const random = seededRandom(20261015);
  await page.route(
    (url) => url.pathname.startsWith("/api/"),
    async (route) => {
      const delay = 100 + Math.floor(random() * 700);
      await new Promise((resolve) => setTimeout(resolve, delay));
      await route.continue().catch(() => undefined);
    },
  );

  const conversationOf = (projectId) => new RegExp(`/chat/(${sessions[projectId]}|new)$`);
  await page.goto(`/chat/${sessions[a]}`);
  await expect(page.getByRole("button", { name: "Alpha Project", exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page).toHaveURL(new RegExp(`/chat/${sessions[a]}$`));

  for (let round = 0; round < 3; round += 1) {
    // A→B→A→B with each click landing while the previous switch is still loading.
    await switchProject(page, "Alpha Project", "Beta Project");
    await switchProject(page, "Beta Project", "Alpha Project");
    await switchProject(page, "Alpha Project", "Beta Project");
    await expect(page).toHaveURL(conversationOf(b), { timeout: 30_000 });
    // And back to A, which settles on A's own conversation again.
    await switchProject(page, "Beta Project", "Alpha Project");
    await expect(page).toHaveURL(conversationOf(a), { timeout: 30_000 });
  }

  // The Agents page of each Project lists its own Agent and never the other's.
  await page.getByRole("link", { name: "智能体" }).click();
  const main = page.getByRole("main");
  await expect(main.getByText("Alpha Agent", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(main.getByText("Beta Agent", { exact: true })).toHaveCount(0);
  await switchProject(page, "Alpha Project", "Beta Project");
  await switchProject(page, "Beta Project", "Alpha Project");
  await switchProject(page, "Alpha Project", "Beta Project");
  await expect(main.getByText("Beta Agent", { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(3_000);
  await expect(main.getByText("Beta Agent", { exact: true })).toBeVisible();
  await expect(main.getByText("Alpha Agent", { exact: true })).toHaveCount(0);

  // A new chat in B starts from its remembered draft, which names A's Agent.
  await page.getByRole("button", { name: "新建对话" }).first().click();
  await expect(page).toHaveURL(/\/chat\/new$/);
  await expect(page.getByRole("heading", { name: "PenguinHarness" })).toBeVisible({
    timeout: 30_000,
  });
  await page.waitForTimeout(3_000);

  // The cost center, opened on A's Agent by its deep link (an in-app navigation), then B.
  await switchProject(page, "Beta Project", "Alpha Project");
  const filtered = page.waitForRequest((req) => {
    const url = new URL(req.url());
    return (
      url.pathname === `/api/projects/${a}/usage` &&
      url.searchParams.get("agentId") === "alpha_only"
    );
  });
  await page.evaluate(() => {
    const idx = (window.history.state?.idx ?? 0) + 1;
    window.history.pushState({ usr: null, key: "e2e", idx }, "", "/usage?agentId=alpha_only");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(page).toHaveURL(/\/usage\?agentId=alpha_only$/);
  await filtered;
  await switchProject(page, "Alpha Project", "Beta Project");
  await page.waitForTimeout(3_000);

  expect(bad).toEqual([]);
});
