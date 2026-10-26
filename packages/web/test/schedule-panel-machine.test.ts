// @vitest-environment jsdom
/**
 * The chat dock's scheduled-tasks panel for a conversation that runs on a machine
 * (features/schedules/schedule-panel.tsx). That conversation's Agent is the machine's, and its
 * tasks are files over there.
 *
 * - Given a task bound to the conversation on the machine, the panel lists it; a task of this
 *   server bound to the same conversation id is not the machine's and is not listed.
 * - Given the switch on that task, the change is written on the machine, and this server's tasks
 *   are left as they were.
 * - Given an edit from the row menu, the saved task lands on the machine.
 * - Given a delete from the row menu, confirmed, the task is removed on the machine.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createElement as h } from "react";
import type { ScheduleItem, SessionInfo } from "@prismshadow/penguin-server/api";
import { SchedulePanel } from "../src/features/schedules/schedule-panel";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import {
  AGENT_ID,
  PROJECT_ID,
  agentConfig,
  agentServer,
  buttonIn,
  fieldIn,
  mountAgentApp,
  topDialog,
} from "./helpers/agent-app";
import { button, click, dialogs, type, unmountAll, waitFor } from "./helpers/dom";

const MACHINE = "QS7J4YVgSovi-Z2c";
const SESSION = "session-2026-10-15-21-07-10-1ecd53be";

const task = (name: string, prompt: string): ScheduleItem => ({
  name,
  prompt,
  enabled: true,
  startAt: "2026-10-17T01:00:00.000Z",
  period: "1d",
  sessionId: SESSION,
  status: "active",
  nextFireAt: "2026-10-17T01:00:00.000Z",
  queued: false,
});

const session = {
  sessionId: SESSION,
  projectId: PROJECT_ID,
  agentId: AGENT_ID,
  provider: "custom",
  modelId: "m",
  workspace: "/home/penguin",
  approvalMode: "allow-all",
  sandbox: { mode: "danger-full-access", network: "open" },
  createdAt: "2026-10-15T21:07:10.000Z",
  lastActiveAt: "2026-10-15T21:07:10.000Z",
  status: "idle",
  pendingApprovalCount: 0,
  pendingFollowUpCount: 0,
  hasTrace: true,
  archived: false,
} as SessionInfo;

async function openPanel() {
  const server = agentServer(agentConfig(), {
    machines: [{ machineId: MACHINE, alias: "box", agents: [AGENT_ID] }],
    schedules: [
      { machineId: MACHINE, item: task("standup", "Summarise yesterday on the box.") },
      // This server's task under the same conversation id: another server's file entirely.
      { item: task("local-only", "Not this conversation's.") },
    ],
  });
  await mountAgentApp(
    h(SchedulePanel, { session, machineId: MACHINE, active: true, onPrefillComposer: () => {} }),
    {
      route: "/chat/:sessionId",
      at: `/chat/${SESSION}`,
    },
  );
  await waitFor(() => document.body.textContent?.includes("standup") === true);
  return server;
}

const toMachine = (path: string, server: ReturnType<typeof agentServer>) =>
  server.writes(path).filter((r) => r.machine === MACHINE);

describe("the scheduled-tasks panel of a conversation on a machine", () => {
  beforeAll(() => setActiveStrings(en));
  afterAll(() => setActiveStrings(zh));
  afterEach(async () => {
    await unmountAll();
  });

  it("lists the machine's task for the conversation, and not this server's", async () => {
    await openPanel();
    expect(document.body.textContent).not.toContain("local-only");
  });

  it("writes the switch on the machine, leaving this server's tasks as they were", async () => {
    const server = await openPanel();
    await click(button(en.schedule.disable));
    await waitFor(() => toMachine("/schedules/standup", server).length === 1);
    expect(server.writes("/schedules/standup").every((r) => r.machine === MACHINE)).toBe(true);
    expect(server.machineSchedules(MACHINE).find((s) => s.name === "standup")?.enabled).toBe(false);
    expect(server.schedules().map((s) => [s.name, s.enabled])).toEqual([["local-only", true]]);
  });

  it("saves an edit from the row menu on the machine", async () => {
    const server = await openPanel();
    await click(button(en.schedule.rowActions));
    await click(button(en.common.edit));
    await waitFor(() => dialogs().length === 1);
    await type(fieldIn(topDialog(), en.schedule.prompt), "Summarise the week on the box.");
    await click(buttonIn(topDialog(), en.common.save));
    await waitFor(() => dialogs().length === 0);
    expect(toMachine("/schedules/standup", server)).toHaveLength(1);
    expect(server.machineSchedules(MACHINE).find((s) => s.name === "standup")?.prompt).toBe(
      "Summarise the week on the box.",
    );
  });

  it("deletes a task from the row menu on the machine, once confirmed", async () => {
    const server = await openPanel();
    await click(button(en.schedule.rowActions));
    await click(button(en.common.delete));
    await waitFor(() => dialogs().length === 1);
    await click(buttonIn(topDialog(), en.common.delete));
    await waitFor(() => server.machineSchedules(MACHINE).length === 0);
    expect(toMachine("/schedules/standup", server).map((r) => r.method)).toEqual(["DELETE"]);
    expect(server.schedules().map((s) => s.name)).toEqual(["local-only"]);
  });
});
