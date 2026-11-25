/** @vitest-environment jsdom */
/**
 * The terminal panel's body (features/terminal/terminal-panel.tsx), rendered in a dock tab's
 * provider and driven the way a user does; the servers are faked at `fetch`.
 *
 * - Given a conversation with live shells, the strip lists exactly its own, numbered and titled,
 *   marks the shown one and shows its screen; another Session's shell is not there.
 * - Given "+", another shell starts for the conversation and is the one shown.
 * - A shell's × asks for confirmation. The last shell leaving keeps the empty group open.
 * - Viewing an empty group performs no write; only an explicit new-shell action creates one.
 * - A failed start is retryable in the same group.
 */
import { createElement as h } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as dock from "@prismshadow/penguin-library-session/web/dock/dock-state";
import * as terminal from "@prismshadow/penguin-library-session/web/dock/dock-terminal";
import { DockPanelProvider } from "@prismshadow/penguin-library-session/web/dock/panel-context";
import type { DockPanelHandle } from "@prismshadow/penguin-library-session/web/dock/panel-context";
import { TerminalPanel } from "../src/features/terminal";
import * as list from "../src/features/terminal";
import * as machines from "../src/lib/terminal-machines";
import { S } from "../src/lib/strings";
import { ThemeProvider } from "../src/state/theme";
import { button, click, mount, run, settle, unmountAll, waitFor } from "./helpers/dom";
import { apiError, json, stubFetch, type FetchRequest } from "./helpers/fetch";

interface Shell {
  id: string;
  seq: number;
  sessionId: string | null;
}

/** Each server's shells: null is this server, otherwise a machine id. */
const held = new Map<string | null, Shell[]>();
/** Machines that fail to answer this round. */
const silent = new Set<string>();
/** While set, starting a shell fails the way a broken pty does. */
let spawnFails = false;
let created = 0;

function info(shell: Shell) {
  return {
    id: shell.id,
    seq: shell.seq,
    name: `sh-${shell.id}`,
    cwd: "/work",
    alive: true,
    sessionId: shell.sessionId,
  };
}

async function answer(request: FetchRequest): Promise<Response> {
  if (request.machine !== null && silent.has(request.machine)) throw new TypeError("no answer");
  const shells = held.get(request.machine) ?? [];
  if (request.path === "/api/terminals" && request.method === "GET") {
    return json({ terminals: shells.map(info) });
  }
  if (request.path === "/api/terminals" && request.method === "POST") {
    if (spawnFails) return apiError(500, "terminal_spawn_failed", "posix_spawn failed (mock)");
    created += 1;
    const body = request.body as { sessionId: string | null };
    const shell = { id: `created-${created}`, seq: shells.length + 1, sessionId: body.sessionId };
    held.set(request.machine, [...shells, shell]);
    return json(info(shell), 201);
  }
  const one = /^\/api\/terminals\/([^/]+)$/.exec(request.path);
  if (one !== null && request.method === "DELETE") {
    held.set(
      request.machine,
      shells.filter((shell) => shell.id !== one[1]),
    );
    return new Response(null, { status: 204 });
  }
  return apiError(404, "terminal_not_found");
}

let seq = 0;
/** A fresh conversation on screen, its terminal panel open; its shells are `shells`. */
async function conversationWith(
  shells: Omit<Shell, "sessionId">[],
  machineId: string | null = null,
) {
  seq += 1;
  const sessionId = `session-panel-${seq}`;
  created = 0;
  held.clear();
  held.set(
    machineId,
    shells.map((shell) => ({ ...shell, sessionId })),
  );
  dock.setDockScope(sessionId);
  terminal.setDockConversation({ sessionId, workspace: "/work", machineId });
  terminal.openTerminalPanel();
  await list.refreshTerminals();
  return sessionId;
}

/** Renders the body in a dock tab's provider; `show` re-renders it on or off screen. */
async function renderPanel() {
  // jsdom has no `matchMedia`; the theme asks it for the system's light or dark.
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  // What the dock does with a body's close: the tab goes.
  const close = vi.fn(() => dock.removeTab(terminal.TERMINAL_PANEL));
  const tree = (active: boolean) => {
    const handle: DockPanelHandle = {
      id: terminal.TERMINAL_PANEL,
      position: "bottom",
      merged: false,
      active,
      fullscreen: false,
      setFullscreen: () => {},
      close,
    };
    return h(
      ThemeProvider,
      null,
      h(DockPanelProvider, { handle, children: h(TerminalPanel, { active }) }),
    );
  };
  const mounted = await mount(tree(true));
  return { close, show: (active: boolean) => mounted.rerender(tree(active)) };
}

const tabs = () => [...document.querySelectorAll('[data-testid="terminal-tab"]')];
const screenId = () =>
  document.querySelector('[data-testid="dock-terminal-body"]')?.getAttribute("data-terminal-id");
const writes = (fake: { requests: FetchRequest[] }) =>
  fake.requests.filter((request) => request.method !== "GET").map((r) => r.method);

afterEach(async () => {
  await unmountAll();
  silent.clear();
  spawnFails = false;
  vi.restoreAllMocks();
  machines.forgetTerminalMachines();
  // Background re-reads land against this test's servers, not the next one's.
  await list.refreshTerminals();
});

describe("the terminal panel", () => {
  it("lists exactly the conversation's shells, numbered and titled, and shows the kept one", async () => {
    const fake = stubFetch(answer);
    await conversationWith([
      { id: "a", seq: 1 },
      { id: "b", seq: 2 },
    ]);
    held.get(null)!.push({ id: "theirs", seq: 3, sessionId: "another-session" });
    await list.refreshTerminals();
    dock.setShownShell("a");

    await renderPanel();

    expect(tabs().map((tab) => tab.getAttribute("data-tab-id"))).toEqual(["a", "b"]);
    expect(tabs()[0]?.textContent).toBe("1: sh-a");
    expect(tabs()[0]?.getAttribute("data-active")).toBe("true");
    expect(screenId()).toBe("a");
    expect(writes(fake)).toEqual([]);
  });

  it("starts another shell with + and shows it", async () => {
    const fake = stubFetch(answer);
    const mine = await conversationWith([{ id: "a", seq: 1 }]);
    await renderPanel();

    await click(button(S.terminal.newShell));
    await waitFor(() => screenId() === "created-1");

    expect(fake.requests.find((r) => r.method === "POST")?.body).toMatchObject({
      sessionId: mine,
    });
    expect(tabs().map((tab) => tab.getAttribute("data-tab-id"))).toEqual(["a", "created-1"]);
  });

  it("confirms the last shell's close and keeps its empty group open", async () => {
    const fake = stubFetch(answer);
    await conversationWith([{ id: "a", seq: 1 }]);
    const { close } = await renderPanel();
    await click(button(`${S.terminal.killShell}: 1: sh-a`));
    expect(writes(fake)).toEqual([]);
    await click(button(S.terminal.killShell));
    await waitFor(() => tabs().length === 0);
    expect(writes(fake)).toEqual(["DELETE"]);
    expect(close).not.toHaveBeenCalled();
    expect(document.querySelector('[data-testid="terminal-new-tab"]')).not.toBeNull();
  });

  it("reads shells opened by another client when the group becomes visible again", async () => {
    const fake = stubFetch(answer);
    const id = await conversationWith([]);
    const { show } = await renderPanel();
    await show(false);
    held.set(null, [
      { id: "other-client", seq: 1, sessionId: id },
      { id: "other-session", seq: 2, sessionId: "another-session" },
    ]);
    await show(true);
    await waitFor(() => screenId() === "other-client");
    expect(tabs()).toHaveLength(1);
    expect(writes(fake)).toEqual([]);
  });

  it("opens an empty group without starting a shell, including after hiding and showing", async () => {
    const fake = stubFetch(answer);
    await conversationWith([]);
    const { show } = await renderPanel();
    await show(false);
    await show(true);
    expect(writes(fake)).toEqual([]);
    expect(tabs()).toHaveLength(0);
    await click(document.querySelector<HTMLButtonElement>('[data-testid="terminal-new-tab"]')!);
    await waitFor(() => screenId() === "created-1");
    expect(writes(fake)).toEqual(["POST"]);
  });

  it("keeps the group available after its last shell exits, including a partial list refresh", async () => {
    const fake = stubFetch(answer);
    machines.setTerminalMachines(["M"]);
    await conversationWith([{ id: "only", seq: 1 }]);
    const { close } = await renderPanel();
    held.set(null, []);
    silent.add("M");
    await run(() => list.refreshTerminals());
    expect(close).not.toHaveBeenCalled();
    silent.clear();
    await run(() => list.refreshTerminals());
    expect(tabs()).toHaveLength(0);
    expect(close).not.toHaveBeenCalled();
    expect(writes(fake)).toEqual([]);
  });

  it("retries a failed explicit start in the same group", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fake = stubFetch(answer);
    await conversationWith([]);
    spawnFails = true;
    const { close } = await renderPanel();
    const newShell = () =>
      document.querySelector<HTMLButtonElement>('[data-testid="terminal-new-tab"]')!;
    await click(newShell());
    await settle();
    expect(writes(fake)).toEqual(["POST"]);
    expect(tabs()).toHaveLength(0);
    spawnFails = false;
    await click(newShell());
    await waitFor(() => screenId() === "created-1");
    expect(writes(fake)).toEqual(["POST", "POST"]);
    expect(close).not.toHaveBeenCalled();
  });
});
