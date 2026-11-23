import { test, expect } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";
import { setAccountPrefs } from "./account-prefs.mjs";

test("an App Center workbench lists archived Sessions and closes only their selected terminal groups", async ({
  page,
}) => {
  test.setTimeout(75000);
  await provisionAndLogin(page.request, "workbenchpick" + process.pid, "password123");
  await setAccountPrefs(page.request, { lang: "en" });
  const { projects } = await (await page.request.get("/api/projects")).json();
  const project = projects[0].projectId;
  const base = "/api/projects/" + project;
  const model = { provider: "custom", modelId: "claude-4-8" };
  await expect(
    await page.request.put(base + "/models", {
      data: {
        defaultModel: model,
        models: [
          { ...model, apiKey: "sk-test", baseUrl: process.env.MOCK_URL, contextWindow: 200000 },
        ],
      },
    }),
  ).toBeOK();
  const terminalTile = page
    .locator('[data-app="system_agent/session-tools-terminal"] > button')
    .first();
  const counts = async () =>
    (
      await (
        await page.request.get("/api/terminals/projects/" + project + "/session-resources")
      ).json()
    ).counts;
  await page.setViewportSize({ width: 375, height: 750 });
  await page.goto("/apps");
  await terminalTile.click();
  await expect(page.getByText("No matching Sessions.", { exact: true })).toBeVisible();
  expect(await counts()).toEqual({});
  await page.goBack();

  async function session(title, archive) {
    const res = await page.request.post(base + "/agents/default_agent/sessions", {
      data: { approvalMode: "allow-all" },
    });
    await expect(res).toBeOK();
    const { session } = await res.json();
    await expect(
      await page.request.patch("/api/sessions/" + session.sessionId, {
        data: { title, ...(archive ? { archived: true } : {}) },
      }),
    ).toBeOK();
    return session;
  }
  const first = await session("Prior terminal", true);
  const second = await session("Working terminal", false);
  const none = await session("No terminal", false);
  await expect(
    await page.request.post("/api/sessions/" + second.sessionId + "/tasks", {
      data: { input: [{ type: "text", text: "run a subagent" }] },
    }),
  ).toBeOK();
  let child;
  await expect
    .poll(async () => {
      const reply = await page.request.get(
        base + "/agents/default_agent/sessions?limit=30&order=activity",
      );
      const sessions = (await reply.json()).sessions;
      child = sessions.find((row) => row.source === "subagent");
      return child?.sessionId;
    })
    .toBeTruthy();
  await expect
    .poll(
      async () =>
        (await (await page.request.get("/api/sessions/" + second.sessionId)).json()).session.status,
    )
    .toBe("idle");
  await expect(
    await page.request.patch("/api/sessions/" + second.sessionId, {
      data: { title: "Working terminal" },
    }),
  ).toBeOK();
  async function create(s) {
    await expect(
      await page.request.post("/api/terminals", {
        data: { sessionId: s.sessionId, cwd: s.workspace },
      }),
    ).toBeOK();
  }
  await create(first);
  await create(first);
  await create(second);
  await create(child);
  await expect
    .poll(counts)
    .toEqual({ [first.sessionId]: 2, [second.sessionId]: 1, [child.sessionId]: 1 });
  await page.goto("/apps");
  await terminalTile.click();
  const search = page.getByRole("textbox", { name: "Search all Sessions" });
  await expect(search).toBeVisible();
  const old = page.getByRole("button", { name: /Prior terminal/ });
  await expect(old).toContainText("Archived");
  await expect(old).toContainText("2 open terminals");
  await expect(page.getByRole("checkbox", { name: /Select Session No terminal/ })).toBeDisabled();
  const childRow = page.getByRole("button").filter({ hasText: child.sessionId });
  await expect(childRow).toContainText("Subagent");
  await expect(childRow).toContainText("1 open terminal");
  // While the directory stays open, another client can open/close a real child PTY.
  // Its count changes without fetching the paged Session history or clearing selection.
  const retainedSelection = page.getByRole("checkbox", { name: /Select Session Prior terminal/ });
  await retainedSelection.check();
  const historyPages = [];
  const recordDirectoryRead = (request) => {
    if (
      request.method() === "GET" &&
      /\/agents\/[^/]+\/sessions$/.test(new URL(request.url()).pathname)
    )
      historyPages.push(request.url());
  };
  page.on("request", recordDirectoryRead);
  const extra = await page.request.post("/api/terminals", {
    data: { sessionId: child.sessionId, cwd: child.workspace },
  });
  await expect(extra).toBeOK();
  await expect(childRow).toContainText("2 open terminals", { timeout: 15000 });
  await expect(retainedSelection).toBeChecked();
  await expect(await page.request.delete("/api/terminals/" + (await extra.json()).id)).toBeOK();
  await expect(childRow).toContainText("1 open terminal", { timeout: 15000 });
  await expect(retainedSelection).toBeChecked();
  expect(historyPages).toEqual([]);
  page.off("request", recordDirectoryRead);
  await retainedSelection.uncheck();
  // Archived parents and subagents are first-class resource owners. Inspecting either
  // group leaves its archive state and the other Session's live terminals intact.
  await page.setViewportSize({ width: 1280, height: 800 });
  for (const [row, owner, expectedCount] of [
    [old, first, 2],
    [childRow, child, 1],
  ]) {
    const readOwner = async () =>
      (await (await page.request.get("/api/sessions/" + owner.sessionId)).json()).session;
    const original = await readOwner();
    expect(original.archived).toBe(owner === first);
    await row.click();
    const activeGroup = page.locator('[data-testid="terminal-panel"]:visible');
    await expect(activeGroup.getByTestId("terminal-tab")).toHaveCount(expectedCount);
    const owned = (await (await page.request.get("/api/terminals")).json()).terminals.filter(
      (t) => t.alive && t.sessionId === owner.sessionId,
    );
    expect(
      (
        await activeGroup
          .getByTestId("terminal-tab")
          .evaluateAll((tabs) => tabs.map((tab) => tab.getAttribute("data-tab-id")))
      ).sort(),
    ).toEqual(owned.map((t) => t.id).sort());
    expect(await readOwner()).toMatchObject({
      sessionId: original.sessionId,
      source: original.source,
      archived: original.archived,
    });
    await page.goto("/apps");
    await terminalTile.click();
  }
  await page.setViewportSize({ width: 375, height: 750 });
  const hasWrites = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().includes("terminals")) hasWrites.push(r.url());
  });
  await page.getByRole("checkbox", { name: /Select Session Prior terminal/ }).check();
  await page.getByRole("button", { name: /Close selected resources/ }).click();
  const confirm = page.getByRole("dialog");
  await expect(confirm).toContainText("Prior terminal");
  await expect(confirm).toContainText("Running commands");
  await confirm.getByRole("button", { name: "Cancel" }).click();
  expect(hasWrites).toEqual([]);
  await childRow.locator("..").getByRole("checkbox").check();
  await page.getByRole("button", { name: /Close selected resources/ }).click();
  await expect(page.getByRole("dialog")).toContainText(child.title || child.sessionId);
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  await expect.poll(counts).toEqual({ [second.sessionId]: 1 });
  await expect(old).toContainText("0 open terminals");
  await search.fill("Working terminal");
  await expect(old).toHaveCount(0);
  await page.setViewportSize({ width: 1280, height: 800 });
  const match = page
    .getByRole("region", { name: "Terminal", exact: true })
    .getByRole("button", { name: /Working terminal/ });
  await expect(match).toContainText("1 open terminal");
  await match.focus();
  await page.keyboard.press("Enter");
  const attached = page.locator(
    '[data-testid="dock-tab"][data-tab-id^=":app:session-tool/terminal"]',
  );
  await expect(attached).toBeVisible();
  await expect(
    page.locator('[data-pane="left"][data-workspace-page*="' + second.sessionId + '"]'),
  ).toBeVisible();
  await attached.getByTestId("dock-tab-close").click();
  await expect(page).toHaveURL(new RegExp("/chat/" + second.sessionId));
  await expect.poll(counts).toEqual({ [second.sessionId]: 1 });
  expect(
    (await (await page.request.get("/api/sessions/" + first.sessionId)).json()).session.archived,
  ).toBe(true);
  expect(hasWrites.filter((u) => u.endsWith("/close"))).toHaveLength(1);
  expect(hasWrites.filter((u) => u.endsWith("/api/terminals"))).toEqual([]);
  const chat = page.locator('[data-pane="full"][data-workspace-page*="' + second.sessionId + '"]');
  const composer = chat.locator('[data-slot="composer"] textarea').first();
  await composer.fill("Keep my draft while browsing");
  for (const kind of ["workspace", "memory", "agents", "trace"]) {
    await page.getByRole("button", { name: "Shortcuts", exact: true }).click();
    await page.getByTestId("dock-launcher-open-" + kind).click();
    const tab = page.locator(
      '[data-testid="dock-tab"][data-tab-id^=":app:session-tool/' + kind + '"]',
    );
    await expect(tab).toBeVisible();
    await expect(page).toHaveURL(new RegExp("/session-tools/" + kind + "\\?"));
    expect(new URL(page.url()).searchParams.get("session")).toBe(second.sessionId);
    await tab.getByTestId("dock-tab-close").click();
    await expect(composer).toHaveValue("Keep my draft while browsing");
  }
  // Only explicitly opening this Session's terminal starts its first shell.
  await page.goto("/chat/" + none.sessionId);
  await page.getByRole("button", { name: "Shortcuts", exact: true }).click();
  await page.getByTestId("dock-launcher-open-terminal").click();
  const group = page.locator('[data-testid="terminal-panel"]:visible');
  await expect(group.getByTestId("terminal-tab")).toHaveCount(1);
  await expect.poll(counts).toEqual({ [second.sessionId]: 1, [none.sessionId]: 1 });
  const shell = await group.getByTestId("terminal-tab").getAttribute("data-tab-id");
  await page
    .locator('[data-testid="dock-tab"][data-tab-id^=":app:session-tool/terminal"]:visible')
    .getByTestId("dock-tab-close")
    .click();
  await expect(page).toHaveURL(new RegExp("/chat/" + none.sessionId));
  await page.goto("/apps");
  await terminalTile.click();
  await page
    .getByRole("region", { name: "Terminal", exact: true })
    .getByRole("button", { name: /No terminal/ })
    .click();
  await expect(group.getByTestId("terminal-tab")).toHaveAttribute("data-tab-id", shell);
  expect(await counts()).toEqual({ [second.sessionId]: 1, [none.sessionId]: 1 });
  await page
    .locator('[data-testid="dock-tab"][data-tab-id^=":app:session-tool/terminal"]:visible')
    .getByTestId("dock-tab-close")
    .click();

  // Previous layouts store physical panel IDs. Opening the same scoped app should use its
  // existing tab and leave the user's dormant layout in place after closing the app.
  await page.evaluate((sid) => {
    const key = "penguin.dock.layout";
    const layout = JSON.parse(localStorage.getItem(key) || '{"scopes":{}}');
    layout.scopes[sid] = {
      right: { open: false, active: "memory", tabs: ["memory"] },
      bottom: { open: false, active: null, tabs: [] },
      focus: "right",
      shell: null,
    };
    localStorage.setItem(key, JSON.stringify(layout));
  }, none.sessionId);
  await page.goto("/chat/" + none.sessionId);
  await page.getByRole("button", { name: "Shortcuts", exact: true }).click();
  await page.getByTestId("dock-launcher-open-memory").click();
  const memory = page.locator('[data-testid="dock"]:visible').getByRole("tab", {
    name: "Memory",
    exact: true,
  });
  await expect(memory).toHaveCount(1);
  expect(new URL(page.url()).searchParams.get("session")).toBe(none.sessionId);
  await memory.locator("..").getByTestId("dock-tab-close").click();
  await expect(page).toHaveURL(new RegExp("/chat/" + none.sessionId));
  expect(
    await page.evaluate(
      (sid) => JSON.parse(localStorage.getItem("penguin.dock.layout")).scopes[sid].right,
      none.sessionId,
    ),
  ).toMatchObject({ open: false, active: "memory", tabs: ["memory"] });

  const leaf = "panel-draft.txt";
  await expect(
    await page.request.put("/api/sessions/" + none.sessionId + "/files/content?path=" + leaf, {
      data: { dataBase64: Buffer.from("Saved on disk").toString("base64") },
    }),
  ).toBeOK();
  await page.evaluate((sid) => {
    const key = "penguin.dock.layout";
    const layout = JSON.parse(localStorage.getItem(key));
    layout.scopes[sid].bottom = { open: true, active: "workspace", tabs: ["workspace"] };
    layout.scopes[sid].focus = "bottom";
    localStorage.setItem(key, JSON.stringify(layout));
  }, none.sessionId);
  await page.reload();
  const bottom = page.locator('[data-testid="dock"][data-position="bottom"]');
  const right = page.locator('[data-testid="dock"][data-position="right"]');
  await bottom.getByText(leaf, { exact: true }).first().click();
  await bottom.getByRole("button", { name: "Edit", exact: true }).click();
  const editorName = { name: "Editing " + leaf, exact: true };
  const original = bottom.getByRole("textbox", editorName);
  await original.fill("Draft in my original Files tab");
  const originalNode = await original.elementHandle();
  await bottom.getByTestId("dock-close").click();
  await expect(bottom).toBeHidden();
  await page.getByRole("button", { name: "Shortcuts", exact: true }).click();
  await page.getByTestId("dock-launcher-open-workspace").focus();
  await page.keyboard.press("Enter");
  const moved = right.getByRole("textbox", editorName);
  await expect(moved).toHaveValue("Draft in my original Files tab");
  expect(await moved.evaluate((node, original) => node === original, originalNode)).toBe(true);
  await right.getByRole("button", { name: "Close panel: Files", exact: true }).click();
  await expect(page).toHaveURL(new RegExp("/chat/" + none.sessionId));
  expect(
    await originalNode.evaluate(
      (node) =>
        node.isConnected && node.closest('[data-testid="dock"]')?.getAttribute("data-position"),
    ),
  ).toBe("bottom");
  expect(await originalNode.inputValue()).toBe("Draft in my original Files tab");
  expect(
    await page.evaluate(
      (sid) => JSON.parse(localStorage.getItem("penguin.dock.layout")).scopes[sid].bottom,
      none.sessionId,
    ),
  ).toMatchObject({ open: false, active: "workspace", tabs: ["workspace"] });
});
