/**
 * Subagents panel as a dock tab: a spawned child session leaves only a full-width shortcut
 * row in the main stream; clicking it brings the agents tab up with that Task's call graph
 * (root + children, clickable nodes, per-node elapsed time) above the selected child's live
 * conversation. Verifies the row/panel flow live, across a mid-run reload and an
 * after-completion reload (the parent Trace stores only a session_meta pointer for the child;
 * the server expands the child Trace and the frontend reattaches it), the agents and
 * Workspace tabs COEXISTING in one dock (activating one covers, never closes, the other),
 * the historical topology (the old turn's row pins its Task back; closing the tab and
 * reopening from the toolbar returns to the latest), the child-session title generated from
 * the child's own conversation, the sidebar "Subagents" folder, the identity strip's
 * jump-to-session button, and — in a second always-ask session — that an approval INSIDE
 * the child stays discoverable (row badge) and actionable from the panel.
 * A dedicated reload-free test drives the auto-open lifecycle (auto-open on the current
 * task's first live spawn, re-armed per task, a mid-task manual close respected, an open
 * tab surviving a plain follow-up task), and a draft-flow test covers /chat/new: the panel
 * auto-opens on the session's first live spawn, and the child conversation shows its own
 * user prompt both live (forwarded by run_subagent) and after a reload (child-Trace
 * expansion).
 *
 * Standalone spec: shares one server with chat.spec.mjs, so it registers its own users here
 * (registration auto-provisions a `project-<8hex>`), independent of chat.spec's execution order.
 */
import { test, expect } from "@playwright/test";
import { provisionAndLogin } from "./auth.mjs";

const BASE = process.env.BASE_URL;
const MOCK = process.env.MOCK_URL;
const P = "password123";

/** Register a user, wire the mock model into their auto-provisioned Project, and create one session. */
async function provisionSession(page, username, sessionOverrides = {}) {
  await provisionAndLogin(page.request, username, P);
  const projects = await (await page.request.get(`${BASE}/api/projects`)).json();
  expect(projects.projects, "auto-provisioned project").toHaveLength(1);
  const projectId = projects.projects[0].projectId;

  const put = await page.request.put(`${BASE}/api/projects/${projectId}/models`, {
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
  expect(put.ok(), "put models").toBeTruthy();

  const agentId = "default_agent";
  const sessRes = await page.request.post(
    `${BASE}/api/projects/${projectId}/agents/${agentId}/sessions`,
    { data: { provider: "custom", modelId: "claude-4-8", ...sessionOverrides } },
  );
  expect(sessRes.ok(), `create session: ${await sessRes.text()}`).toBeTruthy();
  const sess = await sessRes.json();
  return { projectId, agentId, sessionId: sess.session.sessionId };
}

/** The subagent shortcut row in the message stream (accessible name leads with 子会话 + the resolved agent name — unchanged by the bar restyle). */
const chipOf = (page) => page.getByRole("button", { name: /子会话/ }).first();

/** The child session's own user prompt (run_subagent's `prompt`): must show in the panel's child conversation, live and after reloads. */
const CHILD_PROMPT = "Count the TODO items in the repository";

/**
 * Wait for the chip, expanding its "Reasoning & Tools" group when needed: the group is open
 * while the turn runs but collapses (chip included) once the turn is over, and around a reload
 * either state is possible — poll the whole reveal so every interleaving converges.
 */
async function revealChip(page) {
  const chip = chipOf(page);
  await expect(async () => {
    if (await chip.isVisible()) return;
    const done = page.getByRole("button", { name: /运行完毕/ }).first();
    if (await done.isVisible()) await done.click();
    expect(await chip.isVisible()).toBeTruthy();
  }).toPass({ timeout: 15_000 });
}

/** The agents dock tab, shown (its dock visible, the tab active). */
const agentsTabActive = (page) =>
  page.locator('[data-testid="dock-tab"][data-tab-id="agents"][data-active="true"]');

/**
 * Click the chip and wait for the agents tab to come up shown. The reveal + click runs as
 * one polled block: the turn can finish between the two steps and collapse the group over
 * the chip, so a failed click retries from the reveal.
 */
async function openPanelViaChip(page) {
  const chip = chipOf(page);
  await expect(async () => {
    if (!(await chip.isVisible())) {
      const done = page.getByRole("button", { name: /运行完毕/ }).first();
      if (await done.isVisible()) await done.click();
    }
    await chip.click({ timeout: 2000 });
  }).toPass({ timeout: 15_000 });
  await expect(agentsTabActive(page)).toBeVisible();
}

test("subagent renders as a chip; the panel shows the call graph and child conversation, and survives reloads", async ({
  page,
}) => {
  // Approval defaults to allow-all: child sessions inherit the parent's approval mode, no
  // manual approval needed in this test.
  const { projectId, agentId, sessionId } = await provisionSession(page, "subuser");

  await page.goto(`${BASE}/chat/${sessionId}`);
  const ta = page.getByPlaceholder(/输入消息/);
  await ta.waitFor();
  await ta.fill("run a subagent");
  await page.getByRole("button", { name: "发送" }).click();

  // The child session leaves only a shortcut row in the stream (the nested conversation no
  // longer renders inline); it appears as soon as the child's first message binds.
  await revealChip(page);

  // --- Mid-run reload: the chip must come back from the rebuilt history and reopen a working panel. ---
  await page.reload();
  await revealChip(page);
  await openPanelViaChip(page);
  // The child conversation streams inside the panel (this text renders nowhere else while the
  // run_subagent tool card stays collapsed).
  await expect(page.getByText("Subagent report: 3 TODOs")).toBeVisible();

  // Parent's final answer: the whole turn has ended; assertions below are deterministic.
  await expect(page.getByText("Command finished; the result looks as expected.")).toBeVisible();

  // --- Call graph: root + child (both run on default_agent, display name "General Agent"). ---
  const graph = page.getByRole("group", { name: "调用关系" });
  await expect(graph.getByRole("button", { name: /General Agent/ })).toHaveCount(2);

  // Clicking the root switches the lower half to the main-session note; clicking the child
  // brings its conversation back.
  await graph.getByRole("button").first().click();
  await expect(page.getByText("主会话请在对话区查看")).toBeVisible();
  await graph.getByRole("button").nth(1).click();
  await expect(page.getByText("Subagent report: 3 TODOs")).toBeVisible();

  // --- After-completion reload: chip reopens the panel, graph and conversation intact
  // (the finished turn's group is collapsed now — revealChip expands it first). ---
  await page.reload();
  await revealChip(page);
  await openPanelViaChip(page);
  await expect(page.getByText("Subagent report: 3 TODOs")).toBeVisible();
  // The child conversation keeps its USER side across a reload (child-Trace expansion carries
  // the child's own user messages; live streaming forwards the same message — both paths must
  // render the user bubble).
  await expect(page.getByText(CHILD_PROMPT)).toBeVisible();
  await expect(
    page.getByRole("group", { name: "调用关系" }).getByRole("button", { name: /General Agent/ }),
  ).toHaveCount(2);
  // The child node shows its settled elapsed time (wall clock of the whole spawn, derived from
  // message timestamps — which is why it survives this history reload); the root shows none, so
  // exactly one duration renders in the graph.
  await expect(
    graph.getByText(/^(\d+(\.\d+)?(ms|s)|\d+m\d+s)$/),
    "one done-node duration in the graph",
  ).toHaveCount(1);

  // --- Tabs coexist: the agents tab and the Workspace tab share the right dock — opening
  // one COVERS the other (it stays in the strip, inactive) instead of closing it, which is
  // exactly what the old drawer exclusivity forbade. The workspace joins through the
  // dock's own "+" menu.
  const rightDock = page.locator('[data-testid="dock"][data-position="right"]');
  await expect(agentsTabActive(page)).toBeVisible(); // shown from the chip click above
  await rightDock.getByTestId("dock-add").click();
  await page.getByTestId("dock-add-workspace").click(); // workspace up -> agents covered, not closed
  await expect(rightDock.locator('[data-tab-id="workspace"][data-active="true"]')).toBeVisible();
  await expect(rightDock.locator('[data-tab-id="agents"][data-active="false"]')).toBeVisible();
  await rightDock.locator('[data-tab-id="agents"]').click(); // and back: agents up front, workspace stays tabbed
  await expect(rightDock.locator('[data-tab-id="agents"][data-active="true"]')).toBeVisible();
  await expect(rightDock.locator('[data-tab-id="workspace"][data-active="false"]')).toBeVisible();
  // The covered tab's body renders nothing on screen (display:none, not a stray strip).
  await expect(page.getByText("根目录")).toBeHidden();
  // Put the workspace tab away for the blocks below via its always-visible ×; the dock
  // stays on the agents tab.
  await rightDock.locator('[data-tab-id="workspace"]').getByTestId("dock-tab-close").click();
  await expect(rightDock.locator('[data-tab-id="workspace"]')).toHaveCount(0);
  await expect(agentsTabActive(page)).toBeVisible();

  // --- Historical topology: a plain follow-up Task makes the first turn's graph historical
  // (the boundary itself — the panel closing on a new Task — is covered by the reload-free
  // lifecycle test below; a send on a reloaded page can trip a pre-existing stream flake, so
  // this block only asserts the topology behaviors). The old turn's subagent row pins that
  // Task's graph back (a chip click is a manual open); a toolbar reopen returns to the DEFAULT
  // latest scope (task 2 spawned nothing). ---
  // Pin the page to the parent session first: if a session-list hiccup ever detours the route
  // (auto-select), this fails with an explicit URL mismatch instead of a swallowed send.
  await expect(page).toHaveURL(new RegExp(sessionId));
  await ta.fill("hello again");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByText("Command finished; the result looks as expected.")).toHaveCount(2);
  await openPanelViaChip(page); // the first turn's row (revealed from its collapsed group)
  await expect(graph.getByRole("button", { name: /General Agent/ })).toHaveCount(2);
  // Node highlight follows the chip's child in the historical graph.
  await expect(graph.getByRole("button", { name: /General Agent/ }).nth(1)).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByText("Subagent report: 3 TODOs")).toBeVisible();
  // Close the tab (its × — the last tab, so the dock goes away with it, dropping the
  // pinned scope), then reopen through the toolbar toggle and the picker -> back to the
  // DEFAULT latest-Task scope.
  await rightDock.locator('[data-tab-id="agents"]').getByTestId("dock-tab-close").click();
  await expect(rightDock).toHaveCount(0);
  await page.getByTestId("dock-toggle-right").click();
  await page.getByTestId("dock-pick-agents").click();
  await expect(agentsTabActive(page)).toBeVisible();
  // Two renders of the note (the graph section and the selection empty state) are fine —
  // both say the same thing about the latest Task.
  await expect(page.getByText("本次任务尚未派生子智能体").first()).toBeVisible();

  // --- Child session title: generated by the model from the run_subagent prompt that spawned it (async, poll until persisted). ---
  const childOf = async () => {
    const list = await (
      await page.request.get(`${BASE}/api/projects/${projectId}/agents/${agentId}/sessions`)
    ).json();
    return list.sessions.find((s) => s.sessionId !== sessionId) ?? null;
  };
  await expect
    .poll(async () => (await childOf())?.title ?? null, { timeout: 10000 })
    .toBe("Subagent TODO summary");
  const child = await childOf();

  // --- The child's OWN Trace session_meta records source=subagent: written by core's spawn
  // site, the single source of truth (the server's registration fallback cannot mask this —
  // it never writes the child Trace), and what the derived list source ultimately rests on. ---
  const childMessages = await (
    await page.request.get(`${BASE}/api/sessions/${child.sessionId}/messages`)
  ).json();
  const childMeta = childMessages.messages.find(
    (m) => m.type === "session_meta" && !m.origin?.length,
  );
  expect(childMeta, "child trace session_meta").toBeTruthy();
  expect(childMeta.payload.source).toBe("subagent");

  // --- Sidebar: the child session (source=subagent) nests inside the collapsed "Subagents"
  // folder (per-origin folders sit parallel to "Archived" within the same temp-workspace
  // group). Reload first so the sidebar list carries the persisted title/source, and the
  // folder is back to its default collapsed state. ---
  await page.reload();
  const sidebar = page.getByRole("complementary");
  const subagentFolder = sidebar.getByRole("button", { name: "子智能体（1）" });
  await expect(subagentFolder, "collapsed Subagents folder").toBeVisible();
  // Collapsed by default: the child row is not rendered until the folder is expanded.
  await expect(sidebar.getByText("Subagent TODO summary")).toHaveCount(0);
  await subagentFolder.click();
  await expect(sidebar.getByText("Subagent TODO summary")).toBeVisible();
});

test("auto-open lifecycle: spawn opens the tab, a plain task keeps it, manual close is respected per task", async ({
  page,
}) => {
  // A dedicated fresh session with NO reloads: every send happens on a live, never-reloaded
  // page, so the assertions are deterministic (a send on a reloaded page can trip a
  // pre-existing stream flake unrelated to the panel — documented on PR #78).
  const { sessionId } = await provisionSession(page, "subuser4");
  await page.goto(`${BASE}/chat/${sessionId}`);
  const ta = page.getByPlaceholder(/输入消息/);
  await ta.waitFor();
  const closeAgentsTab = () =>
    page.locator('[data-tab-id="agents"]').getByTestId("dock-tab-close").click();

  // Task 1 spawns: the tab comes up ITSELF once the spawn goes live (no clicks).
  await ta.fill("run a subagent");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(agentsTabActive(page)).toBeVisible();
  await expect(page.getByText("Command finished; the result looks as expected.")).toBeVisible();
  await expect(agentsTabActive(page)).toBeVisible(); // stays up after the task

  // Task 2 (plain): an open tab SURVIVES the boundary — the arrangement is the user's, and
  // a task that spawns nothing neither opens nor closes anything.
  await ta.fill("hello again");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(page.getByText("Command finished; the result looks as expected.")).toHaveCount(2);
  await expect(agentsTabActive(page)).toBeVisible();

  // Task 3 spawns again after a manual close: the auto-open is RE-ARMED per task (the mock
  // delays this spawn ~800ms, keeping close -> auto-open observable in order); a manual
  // close mid-task is then respected until the next boundary.
  await closeAgentsTab(); // manual close between tasks (the tab's ×)
  await expect(agentsTabActive(page)).toHaveCount(0);
  await ta.fill("run another subagent");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(agentsTabActive(page)).toBeVisible(); // spawn -> auto-open again
  await closeAgentsTab(); // manual close mid-task: the task's one attempt is consumed
  await expect(agentsTabActive(page)).toHaveCount(0);
  await expect(page.getByText("Command finished; the result looks as expected.")).toHaveCount(3);
  await expect(agentsTabActive(page)).toHaveCount(0); // stayed closed for the task
});

test("an approval inside the subagent stays discoverable via the chip badge and actionable from the panel", async ({
  page,
}) => {
  // always-ask: the parent's run_subagent needs a manual allow, and the child's own
  // exec_command then parks on a NESTED approval (the child inherits the approval mode).
  const { sessionId } = await provisionSession(page, "subuser2", { approvalMode: "always-ask" });

  await page.goto(`${BASE}/chat/${sessionId}`);
  const ta = page.getByPlaceholder(/输入消息/);
  await ta.waitFor();
  await ta.fill("run a subagent");
  await page.getByRole("button", { name: "发送" }).click();

  // Approve the parent's run_subagent in the main stream.
  await page.getByRole("button", { name: "允许" }).click();

  // The child's exec_command approval surfaces on the chip (待审批 joins its accessible name)
  // and as an amber dot on the right-dock toggle — discoverable with the panel closed.
  const pendingChip = page.getByRole("button", { name: /子会话.*待审批/ });
  await expect(pendingChip).toBeVisible();
  const rightToggle = page.getByTestId("dock-toggle-right");
  await expect(rightToggle.locator("span.bg-amber-500")).toBeVisible();

  // Open the panel from the chip and approve the child's tool call from inside it.
  await pendingChip.click();
  await expect(page.locator('[data-tab-id="agents"][data-active="true"]')).toBeVisible();
  await expect(page.getByText("exec_command").first()).toBeVisible();
  await page.getByRole("button", { name: "允许" }).click();

  // The child completes inside the panel, and the parent's turn then runs to completion.
  await expect(page.getByText("Subagent report: 3 TODOs")).toBeVisible();
  await expect(page.getByText("Command finished; the result looks as expected.")).toBeVisible();
  // The pending badge is gone once the approval is decided (asserted on the always-visible
  // toolbar toggle — the chip itself collapses with its group when the turn ends).
  await expect(rightToggle.locator("span.bg-amber-500")).toHaveCount(0);
});

test("draft flow: the panel auto-opens on the first live spawn and the child conversation shows its user prompt", async ({
  page,
}) => {
  // No pre-created session: the conversation is BORN FROM THE /chat/new DRAFT — the flow where
  // the panel has never been opened for the session and must introduce itself on the first
  // live spawn (owner report: a child ran invisibly after new-chat + send).
  await provisionAndLogin(page.request, "subuser3", P);
  const projects = await (await page.request.get(`${BASE}/api/projects`)).json();
  const projectId = projects.projects[0].projectId;
  const put = await page.request.put(`${BASE}/api/projects/${projectId}/models`, {
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
  expect(put.ok(), "put models").toBeTruthy();

  await page.goto(`${BASE}/chat/new`);
  const ta = page.getByPlaceholder(/输入消息/);
  await ta.waitFor();
  await ta.fill("run a subagent");
  await page.getByRole("button", { name: "发送" }).click();
  await page.waitForURL(/\/chat\/session-/);

  // The panel auto-opens as soon as the spawn goes live — no clicks (the child's exec_command
  // sleeps ~1s, so the Task reliably outlives the draft navigation and the client attaches
  // while the spawn is still running).
  await expect(page.locator('[data-tab-id="agents"][data-active="true"]')).toBeVisible();
  // The child conversation INCLUDES its user side while LIVE: run_subagent forwards the child's
  // input message itself (origin-tagged), not just the model's output.
  await expect(page.getByText(CHILD_PROMPT)).toBeVisible();
  await expect(page.getByText("Subagent report: 3 TODOs")).toBeVisible();
  await expect(page.getByText("Command finished; the result looks as expected.")).toBeVisible();

  // After a reload the same user message comes back from the child-Trace expansion.
  await page.reload();
  await revealChip(page);
  await openPanelViaChip(page);
  await expect(page.getByText(CHILD_PROMPT)).toBeVisible();
  await expect(page.getByText("Subagent report: 3 TODOs")).toBeVisible();
});
