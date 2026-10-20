// @vitest-environment jsdom
/**
 * The messaging editor of a conversation, as the dock panel shows it, against a server behind
 * the fetch fake (features/messaging/messaging-binding-editor.tsx, messaging-panel.tsx).
 *
 * - Given a conversation on a machine that is reconnecting, the editor asks the machine nothing:
 *   it shows what the machine last answered, read-only, under a notice naming the machine and
 *   the time of that answer, its connection state as the last known one rather than a live one;
 *   the switch and Save take no press.
 * - Given nothing was ever read from that machine in this browser, the notice stands alone.
 * - When the machine is back, the editor reads it and says where the bot connects from, and the
 *   switch turns the bot on over there; the next time the machine is away, the editor shows the
 *   bot on, as it last was on screen.
 * - Given the machine drops while the editor is open, the form stays on what was read, turns
 *   read-only, says the machine's state, and reads the connection state as last known.
 * - Given the bot is already connected on another server, turning it on asks this server who
 *   holds it, refuses naming that server, and never asks the machine to turn it on.
 * - Given a machine that could not be asked, the enable goes through and the editor names that
 *   machine.
 * - Given this server's own conversation, turning a bot off asks nobody first; turning it on
 *   asks this server who holds it, then turns it on here.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createElement as h } from "react";
import { toastStore } from "@prismshadow/penguin-ui";
import type {
  MessagingAccountHoldersResponse,
  MessagingChannelState,
  SessionInfo,
} from "@prismshadow/penguin-server/api";
import { MessagingPanel } from "../src/features/messaging/messaging-panel";
import { rememberBinding } from "../src/features/messaging/messaging-binding-cache";
import { formatDateTime } from "../src/lib/format";
import { rememberMachineSessions } from "../src/lib/machine-cache";
import { forgetSessionMachines, machineForSession } from "../src/lib/session-machines";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { publishMachinesChanged } from "../src/state/machines";
import { AGENT_ID, PROJECT_ID, agentConfig, agentServer, mountAgentApp } from "./helpers/agent-app";
import type { AgentServer } from "./helpers/agent-app";
import { button, click, run, unmountAll, waitFor } from "./helpers/dom";
import { stubLocalStorage } from "./helpers/storage";

const MACHINE = "QS7J4YVgSovi-Z2c";
const ALIAS = "mdi-b";
const SESSION = "session-2026-10-19-09-00-00-5bd2c0aa";
const LOCAL_SESSION = "session-2026-10-19-09-05-00-0c1e7d42";
const READ_AT = "2026-10-19T08:45:00.000Z";

const session = (sessionId: string): SessionInfo =>
  ({
    sessionId,
    projectId: PROJECT_ID,
    agentId: AGENT_ID,
    provider: "custom",
    modelId: "m",
    workspace: "/home/penguin",
    approvalMode: "allow-all",
    sandbox: { mode: "danger-full-access", network: "open" },
    createdAt: "2026-10-19T09:00:00.000Z",
    lastActiveAt: "2026-10-19T09:00:00.000Z",
    status: "idle",
    pendingApprovalCount: 0,
    pendingFollowUpCount: 0,
    hasTrace: true,
    archived: false,
  }) as SessionInfo;

/** A Telegram bot saved on a conversation, on or off. */
const telegram = (sessionId: string, enabled: boolean): MessagingChannelState => ({
  binding: {
    channel: "telegram",
    sessionId,
    botId: "123456",
    botTokenMasked: "1234…FAKE",
    enabled,
    linePerMessage: false,
    finalReplyOnly: false,
    renderMarkdown: true,
    lastChatKnown: true,
    createdAt: "2026-10-19T08:00:00.000Z",
    updatedAt: "2026-10-19T08:00:00.000Z",
  },
  status: enabled
    ? { state: "connected", lastInboundAt: "2026-10-19T08:40:00.000Z" }
    : { state: "disconnected" },
});

const NOBODY: MessagingAccountHoldersResponse = { holders: [], unreachable: [] };

/** The requests about messaging so far: reads, switches and holder checks, oldest first. */
const messagingCalls = (server: AgentServer) =>
  server.fetch.requests.filter((r) => r.path.includes("/messaging"));

const holderChecks = (server: AgentServer) =>
  server.fetch.requests.filter((r) => r.path.endsWith("/messaging/account-holders"));

const switches = (server: AgentServer) =>
  server.fetch.requests.filter((r) => r.path.endsWith("/state") && r.method === "POST");

/** The connection switch: the one inside the "Enable connection" label. */
function connectionSwitch(): HTMLButtonElement {
  const label = [...document.querySelectorAll("label")].find((l) =>
    l.textContent?.includes(en.messaging.enabled),
  );
  const control = label?.querySelector<HTMLButtonElement>('button[role="switch"]');
  if (control == null) throw new Error("no connection switch on screen");
  return control;
}

const screenText = () => document.body.textContent ?? "";

/** The row the connection switch sits on: the switch, then the connection state's label and word. */
const statusRow = () => connectionSwitch().closest("label")?.parentElement?.textContent ?? "";

/** The notice over the editor, read as a status by assistive technology. */
const noticeText = () => document.querySelector('[role="status"]')?.textContent ?? "";

const toasts = () => toastStore.getState().items;

/**
 * Opens the conversation's messaging panel the way the app does: the sidebar lists the
 * conversation first (which is how the app learns where it lives), then the conversation opens.
 */
async function openPanel(
  sessionId: string,
  {
    reconnecting = false,
    bindings = [telegram(sessionId, false)],
    accountHolders = NOBODY,
    onMachine = true,
  }: {
    reconnecting?: boolean;
    bindings?: MessagingChannelState[];
    accountHolders?: MessagingAccountHoldersResponse;
    onMachine?: boolean;
  } = {},
) {
  const server = agentServer(agentConfig(), {
    machines: [
      {
        machineId: MACHINE,
        alias: ALIAS,
        agents: [AGENT_ID],
        reconnecting,
        sessions: onMachine ? [session(sessionId)] : [],
      },
    ],
    messaging: [{ ...(onMachine ? { machineId: MACHINE } : {}), sessionId, bindings }],
    accountHolders,
  });
  if (onMachine && reconnecting) {
    // Listed while the machine was last connected: the sidebar shows it from that answer.
    rememberMachineSessions(PROJECT_ID, MACHINE, [session(sessionId)]);
  }
  const router = await mountAgentApp(h(MessagingPanel, { sessionId, active: false }), {
    route: "/chat/:sessionId",
    at: "/chat",
  });
  if (onMachine) await waitFor(() => machineForSession(sessionId) === MACHINE, 40);
  await run(() => router.navigate(`/chat/${sessionId}`));
  return server;
}

describe("the messaging editor of a conversation on a machine", () => {
  beforeAll(() => setActiveStrings(en));
  afterAll(() => setActiveStrings(zh));
  beforeEach(() => {
    stubLocalStorage();
    toastStore.setState({ items: [] });
  });
  afterEach(async () => {
    await unmountAll();
    forgetSessionMachines();
  });

  it("asks a reconnecting machine nothing, showing its last answer read-only under the notice", async () => {
    rememberBinding(PROJECT_ID, MACHINE, SESSION, { bindings: [telegram(SESSION, true)] }, READ_AT);
    const server = await openPanel(SESSION, { reconnecting: true });
    await waitFor(() => noticeText().includes(formatDateTime(READ_AT)));
    expect(noticeText()).toContain(ALIAS);
    // The remembered state: the bot was on, with its masked token.
    expect(connectionSwitch().getAttribute("aria-checked")).toBe("true");
    expect(screenText()).toContain("1234…FAKE");
    // "Connected" as the machine last said it, never as a live state.
    expect(statusRow()).toContain(en.messaging.statusLastKnown);
    expect(statusRow()).not.toContain(en.messaging.statusLabel);
    expect(connectionSwitch().disabled).toBe(true);
    expect(button(en.common.save).disabled).toBe(true);
    expect(button(en.messaging.test).disabled).toBe(true);
    expect(messagingCalls(server)).toEqual([]);
  });

  it("stands the notice alone when nothing was ever read from the machine here", async () => {
    const server = await openPanel(SESSION, { reconnecting: true });
    await waitFor(() => noticeText().includes(ALIAS));
    expect(document.querySelector('button[role="switch"]')).toBeNull();
    expect(document.querySelector("[data-skeleton]")).toBeNull();
    expect(messagingCalls(server)).toEqual([]);
  });

  it("reads the machine once it is back, turns the bot on there, and remembers the answer", async () => {
    const server = await openPanel(SESSION, { reconnecting: true });
    await waitFor(() => noticeText().includes(ALIAS));

    server.setReconnecting(MACHINE, false);
    await run(() => publishMachinesChanged());
    await waitFor(() => screenText().includes(en.messaging.runsOn(ALIAS)), 40);
    const reads = messagingCalls(server).filter((r) => r.method === "GET");
    expect(reads.map((r) => [r.machine, r.path])).toContainEqual([
      MACHINE,
      `/api/sessions/${SESSION}/messaging`,
    ]);

    await click(connectionSwitch());
    await waitFor(() => switches(server).length === 1);
    expect(switches(server)[0]!.machine).toBe(MACHINE);
    expect(server.messagingOn(MACHINE, SESSION)[0]!.binding.enabled).toBe(true);
    expect(connectionSwitch().getAttribute("aria-checked")).toBe("true");

    // A later visit while the machine is away again: what was last on screen, asking nothing.
    await unmountAll();
    forgetSessionMachines();
    const later = await openPanel(SESSION, { reconnecting: true });
    await waitFor(() => noticeText().includes(ALIAS));
    expect(connectionSwitch().getAttribute("aria-checked")).toBe("true");
    expect(messagingCalls(later)).toEqual([]);
  });

  it("keeps what was read when the machine drops mid-view, read-only, naming its state", async () => {
    const server = await openPanel(SESSION);
    await waitFor(() => screenText().includes(en.messaging.runsOn(ALIAS)), 40);
    expect(connectionSwitch().disabled).toBe(false);
    expect(statusRow()).toContain(en.messaging.statusLabel);

    server.setReconnecting(MACHINE, true);
    await run(() => publishMachinesChanged());
    await waitFor(() => connectionSwitch().disabled, 40);
    expect(screenText()).not.toContain(en.messaging.runsOn(ALIAS));
    expect(noticeText()).toContain(ALIAS);
    expect(screenText()).toContain("1234…FAKE");
    expect(statusRow()).toContain(en.messaging.statusLastKnown);
    expect(statusRow()).not.toContain(en.messaging.statusLabel);
  });

  it("refuses to turn on a bot held on another server, naming it, and never asks the machine", async () => {
    const server = await openPanel(SESSION, {
      accountHolders: { holders: [{ machineId: "M-other", alias: "mdi-c" }], unreachable: [] },
    });
    await waitFor(() => screenText().includes(en.messaging.runsOn(ALIAS)), 40);
    await click(connectionSwitch());
    await waitFor(() => holderChecks(server).length === 1);
    const check = holderChecks(server)[0]!;
    expect(check.machine).toBeNull();
    expect(check.path).toBe(`/api/projects/${PROJECT_ID}/messaging/account-holders`);
    expect(Object.fromEntries(check.query)).toEqual({ channel: "telegram", accountId: "123456" });
    await waitFor(() => toasts().length > 0);
    expect(toasts().map((t) => t.kind)).toEqual(["error"]);
    expect(toasts()[0]!.text).toContain("mdi-c");
    expect(switches(server)).toEqual([]);
    expect(connectionSwitch().getAttribute("aria-checked")).toBe("false");
  });

  it("turns the bot on when a machine could not be asked, and names that machine", async () => {
    const server = await openPanel(SESSION, {
      accountHolders: {
        holders: [],
        unreachable: [{ machineId: "M-other", alias: "mdi-c", reason: "not_connected" }],
      },
    });
    await waitFor(() => screenText().includes(en.messaging.runsOn(ALIAS)), 40);
    await click(connectionSwitch());
    await waitFor(() => switches(server).length === 1);
    expect(server.messagingOn(MACHINE, SESSION)[0]!.binding.enabled).toBe(true);
    expect(screenText()).toContain("mdi-c");
  });
});

describe("the messaging editor of this server's own conversation", () => {
  beforeAll(() => setActiveStrings(en));
  afterAll(() => setActiveStrings(zh));
  beforeEach(() => {
    stubLocalStorage();
    toastStore.setState({ items: [] });
  });
  afterEach(async () => {
    await unmountAll();
    forgetSessionMachines();
  });

  it("turns a bot off without asking anyone first", async () => {
    const server = await openPanel(LOCAL_SESSION, {
      onMachine: false,
      bindings: [telegram(LOCAL_SESSION, true)],
    });
    await waitFor(() => connectionSwitch().getAttribute("aria-checked") === "true");
    expect(screenText()).not.toContain(ALIAS);
    await click(connectionSwitch());
    await waitFor(() => switches(server).length === 1);
    expect(switches(server)[0]!.machine).toBeNull();
    expect(holderChecks(server)).toEqual([]);
    expect(server.messagingOn(null, LOCAL_SESSION)[0]!.binding.enabled).toBe(false);
  });

  it("asks who holds a bot before turning it on here", async () => {
    const server = await openPanel(LOCAL_SESSION, { onMachine: false });
    await waitFor(() => connectionSwitch().getAttribute("aria-checked") === "false");
    await click(connectionSwitch());
    await waitFor(() => switches(server).length === 1);
    const order = messagingCalls(server)
      .filter((r) => r.method !== "GET" || r.path.endsWith("/account-holders"))
      .map((r) => r.path);
    expect(order).toEqual([
      `/api/projects/${PROJECT_ID}/messaging/account-holders`,
      `/api/sessions/${LOCAL_SESSION}/messaging/telegram/state`,
    ]);
    expect(server.messagingOn(null, LOCAL_SESSION)[0]!.binding.enabled).toBe(true);
  });
});
