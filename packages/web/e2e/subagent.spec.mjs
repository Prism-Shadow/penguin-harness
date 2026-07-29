/**
 * Subagents side panel: a spawned child session leaves only a full-width shortcut row in the
 * main stream; clicking it opens the right-hand panel with that Task's call graph (root +
 * children, clickable nodes, per-node elapsed time) above the selected child's live
 * conversation. Verifies the row/panel flow live, across a mid-run reload and an
 * after-completion reload (the parent Trace stores only a session_meta pointer for the child;
 * the server expands the child Trace and the frontend reattaches it), the agents/files panel
 * exclusivity (opening either closes the other, from any path), the TASK-SCOPED visibility (a
 * new Task closes the panel at its boundary; only a manual open or the current task's own
 * spawn brings it back, the auto-open re-armed per task and a mid-task manual close
 * respected), the historical topology (the old turn's row pins its Task back; a toolbar reopen
 * returns to the latest), the child-session title generated from the child's own conversation,
 * the sidebar "Subagents" folder, and — in a second always-ask session — that an approval
 * INSIDE the child stays discoverable (row badge) and actionable from the panel.
 * A dedicated reload-free test drives the full task-scoped lifecycle (auto-open, boundary
 * close from an open panel, per-task re-arm, manual close held for the rest of the task), and
 * a draft-flow test covers /chat/new: the panel auto-opens on the session's first live spawn,
 * and the child conversation shows its own user prompt both live (forwarded by run_subagent)
 * and after a reload (child-Trace expansion).
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

/**
 * Click the chip and wait for the docked panel (its title is a heading; the toolbar toggle
 * with the same text is a button). The reveal + click runs as one polled block: the turn can
 * finish between the two steps and collapse the group over the chip, so a failed click retries
 * from the reveal.
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
  await expect(page.getByRole("heading", { name: "智能体面板" })).toBeVisible();
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

  // --- Panel exclusivity: the agents panel and the Workspace files panel never show together —
  // opening either one (from any path; the toolbar toggles here) closes the other. A closed
  // docked panel keeps its content MOUNTED at fixed width inside a zero-width clipping window
  // (see files-panel.tsx), sliding past the viewport's right edge — so "not shown" is asserted
  // as out-of-viewport, not as hidden.
  const agentsToggle = page.getByRole("button", { name: "智能体面板" });
  const filesToggle = page.getByRole("button", { name: "打开工作区" });
  const agentsHeading = page.getByRole("heading", { name: "智能体面板" });
  const filesHeading = page.getByRole("heading", { name: "文件" });
  await expect(agentsToggle).toHaveAttribute("aria-expanded", "true"); // open from the chip click above
  await filesToggle.click(); // open files -> agents must close
  await expect(filesToggle).toHaveAttribute("aria-expanded", "true");
  await expect(agentsToggle).toHaveAttribute("aria-expanded", "false");
  await expect(filesHeading).toBeInViewport();
  await expect(agentsHeading).not.toBeInViewport();
  await agentsToggle.click(); // and the reverse: open agents -> files must close
  await expect(agentsToggle).toHaveAttribute("aria-expanded", "true");
  await expect(filesToggle).toHaveAttribute("aria-expanded", "false");
  await expect(agentsHeading).toBeInViewport();
  await expect(filesHeading).not.toBeInViewport();
  // The closed panel must leave NOTHING behind: its clipping window is zero-width, and with
  // border-box sizing a divider there would still paint its 1px right beside the open panel —
  // a hairline, the resize gutter, then the real divider, which reads as a second, empty panel.
  // Polled: the width transition is still running right after the toggle click.
  const shellWidth = (heading) =>
    heading.evaluate((el) => el.closest(".overflow-hidden").getBoundingClientRect().width);
  await expect
    .poll(() => shellWidth(filesHeading), {
      message: "closed panel occupies no width, divider included",
    })
    .toBe(0);
  expect(
    await shellWidth(agentsHeading),
    "open panel is the only one taking width",
  ).toBeGreaterThan(0);

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
  await agentsToggle.click(); // close
  await agentsToggle.click(); // reopen from the toolbar -> back to the DEFAULT latest-Task scope
  await expect(page.getByText("本次任务尚未派生子智能体")).toBeVisible();

  // --- Child session title: generated by the model from the child session's own conversation (async, poll until persisted). ---
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

test("task-scoped panel lifecycle: boundary close, per-task auto-open re-arm, manual close respected", async ({
  page,
}) => {
  // A dedicated fresh session with NO reloads: every send happens on a live, never-reloaded
  // page, so the assertions are deterministic (a send on a reloaded page can trip a
  // pre-existing stream flake unrelated to the panel — documented on PR #78).
  const { sessionId } = await provisionSession(page, "subuser4");
  await page.goto(`${BASE}/chat/${sessionId}`);
  const ta = page.getByPlaceholder(/输入消息/);
  await ta.waitFor();
  const agentsToggle = page.getByRole("button", { name: "智能体面板" });

  // Task 1 spawns: the panel opens ITSELF once the spawn goes live (no clicks).
  await ta.fill("run a subagent");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(agentsToggle).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByText("Command finished; the result looks as expected.")).toBeVisible();
  await expect(agentsToggle).toHaveAttribute("aria-expanded", "true"); // stays open after the task

  // Task 2 (plain): the boundary closes the panel by default — an unrelated task must not
  // inherit it — and with no spawn it STAYS closed.
  await ta.fill("hello again");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(agentsToggle).toHaveAttribute("aria-expanded", "false"); // closed at the boundary
  await expect(page.getByText("Command finished; the result looks as expected.")).toHaveCount(2);
  await expect(agentsToggle).toHaveAttribute("aria-expanded", "false"); // no spawn: stays closed

  // Task 3 spawns again: the auto-open is RE-ARMED per task. Open the panel manually first so
  // the boundary demonstrably closes an OPEN panel before the spawn reopens it (the mock
  // delays this spawn ~800ms, keeping boundary-close -> auto-open observable in order); a
  // manual close mid-task is then respected until the next boundary.
  await agentsToggle.click();
  await expect(agentsToggle).toHaveAttribute("aria-expanded", "true");
  await ta.fill("run another subagent");
  await page.getByRole("button", { name: "发送" }).click();
  await expect(agentsToggle).toHaveAttribute("aria-expanded", "false"); // boundary close first
  await expect(agentsToggle).toHaveAttribute("aria-expanded", "true"); // spawn -> auto-open again
  await agentsToggle.click(); // manual close mid-task: the task's one attempt is consumed
  await expect(agentsToggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByText("Command finished; the result looks as expected.")).toHaveCount(3);
  await expect(agentsToggle).toHaveAttribute("aria-expanded", "false"); // stayed closed for the task
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
  // and as an amber dot on the toolbar toggle — discoverable with the panel closed.
  const pendingChip = page.getByRole("button", { name: /子会话.*待审批/ });
  await expect(pendingChip).toBeVisible();
  const toolbarToggle = page.getByRole("button", { name: "智能体面板" });
  await expect(toolbarToggle.locator("span.bg-amber-500")).toBeVisible();

  // Open the panel from the chip and approve the child's tool call from inside it.
  await pendingChip.click();
  await expect(page.getByRole("heading", { name: "智能体面板" })).toBeVisible();
  await expect(page.getByText("exec_command").first()).toBeVisible();
  await page.getByRole("button", { name: "允许" }).click();

  // The child completes inside the panel, and the parent's turn then runs to completion.
  await expect(page.getByText("Subagent report: 3 TODOs")).toBeVisible();
  await expect(page.getByText("Command finished; the result looks as expected.")).toBeVisible();
  // The pending badge is gone once the approval is decided (asserted on the always-visible
  // toolbar toggle — the chip itself collapses with its group when the turn ends).
  await expect(toolbarToggle.locator("span.bg-amber-500")).toHaveCount(0);
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
  const agentsToggle = page.getByRole("button", { name: "智能体面板" });
  await expect(agentsToggle).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("heading", { name: "智能体面板" })).toBeVisible();
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
