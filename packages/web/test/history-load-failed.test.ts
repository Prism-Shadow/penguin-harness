// @vitest-environment jsdom
/**
 * The transcript's place when a conversation's history could not be read
 * (features/chat/history-load-failed.tsx), for a conversation on a machine and on this server.
 *
 * - Given a conversation on a machine the server is bringing back, the transcript names the
 *   machine by its alias and says it is reconnecting, with the countdown to the next attempt and
 *   Go to Machines under it; the transport's error — the machine's internal id, the SOCKS port —
 *   is not on screen until the details fold is opened.
 * - Given that, Retry now asks the server to try the machine now, and the row follows the
 *   answer to the attempt running; a refused retry is said and the press can be made again.
 * - Given that, Stop retrying asks the server to stop, and the row follows the answer to stopped,
 *   offering Retry.
 * - Given the machine connected again, the history is read again on its own, once.
 * - Given a machine whose server is stopped (nothing is bringing it back), the transcript says
 *   so by its alias, and Go to Machines opens the Machines page.
 * - Given a conversation on this server, the read's own error is shown with a Retry.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement as h } from "react";
import type { MachineInfo, MachinesResponse } from "@prismshadow/penguin-server/api";
import { ADMIN_ME } from "./helpers/admin-settings";
import { button, click, mount, settle, unmountAll, waitFor } from "./helpers/dom";
import { apiError, json, stubFetch } from "./helpers/fetch";
import type { FetchRequest } from "./helpers/fetch";

const PROJECT = "proj";
const MACHINE = "QS7J4YVgSovi-Z2c";
const SESSION = "session-2026-10-19-23-13-46-d47e047f";
const TRANSPORT_ERROR = `The connection to ${MACHINE} did not answer: the session's SOCKS port did not answer: connect ECONNREFUSED 127.0.0.1:37747`;

afterEach(async () => {
  await unmountAll();
  vi.unstubAllGlobals();
});

type Link = "waiting" | "trying" | "cancelled" | "connected" | "stopped";

/** The Project's machine list with `box` in the state the test sets. */
function machineList(link: Link): MachinesResponse {
  const machine = {
    id: "ssh:box",
    alias: "box",
    machineId: MACHINE,
    installed: { version: "0.2.16", at: "2026-10-15T00:00:00.000Z" },
    member: true,
    local: false,
    connection: link === "connected" ? { pid: 1 } : null,
    ...(link === "connected" || link === "stopped"
      ? {}
      : {
          reconnect: {
            since: "2026-10-19T23:16:00.000Z",
            attempts: 1,
            maxAttempts: 5,
            nextAt: link === "waiting" ? new Date(Date.now() + 40_000).toISOString() : null,
            ...(link === "cancelled" ? { gaveUp: "cancelled" } : {}),
            lastError: null,
            diagnosis: null,
          },
        }),
    keepConnected: true,
    api: null,
    root: "~/.penguin/data",
    status: null,
  } as unknown as MachineInfo;
  return { machines: [machine], imageVersion: "0.2.16", job: null } as unknown as MachinesResponse;
}

function server(initial: Link) {
  const state = { link: initial, refuseRetry: false };
  const fetch = stubFetch((request: FetchRequest) => {
    if (request.path === "/api/me") return json(ADMIN_ME);
    if (request.path === "/api/me/prefs") return json({ prefs: {} });
    if (request.path === "/api/projects") {
      return json({
        projects: [
          {
            projectId: PROJECT,
            name: "Project",
            role: "owner",
            ownerUserId: "admin",
            createdAt: "2026-01-01T00:00:00Z",
          },
        ],
      });
    }
    if (request.path === `/api/projects/${PROJECT}/agents`) return json({ agents: [] });
    if (request.path === `/api/projects/${PROJECT}/machines`) return json(machineList(state.link));
    if (
      request.method === "POST" &&
      request.path === `/api/projects/${PROJECT}/machines/ssh%3Abox/reconnect`
    ) {
      if (state.refuseRetry) return apiError(409, "job_running", "A job is running on box.");
      state.link = "trying";
      return json(machineList("trying"));
    }
    if (
      request.method === "POST" &&
      request.path === `/api/projects/${PROJECT}/machines/ssh%3Abox/stop-reconnecting`
    ) {
      state.link = "cancelled";
      return json(machineList("cancelled"));
    }
    return apiError(404, "not_found");
  });
  return { state, fetch };
}

/** The page's modules from one fresh graph: the session-to-machine map is module state. */
async function fresh() {
  vi.resetModules();
  const strings = await import("../src/lib/strings");
  const { en } = await import("../src/lib/strings-en");
  strings.setActiveStrings(en);
  return {
    en,
    failed: await import("../src/features/chat/history-load-failed"),
    machines: await import("../src/state/machines"),
    auth: await import("../src/state/auth"),
    project: await import("../src/state/project"),
    sessionMachines: await import("../src/lib/session-machines"),
    router: await import("react-router"),
  };
}

type Modules = Awaited<ReturnType<typeof fresh>>;

/** The transcript on a chat route, beside the Machines page it can open. */
async function open(modules: Modules, onRetry: () => void) {
  const router = modules.router.createMemoryRouter(
    [
      {
        path: "/chat",
        element: h(modules.failed.HistoryLoadFailed, {
          projectId: PROJECT,
          sessionId: SESSION,
          error: TRANSPORT_ERROR,
          onRetry,
        }),
      },
      { path: "/machines", element: h("p", null, "Machines page") },
    ],
    { initialEntries: ["/chat"] },
  );
  await mount(
    h(
      modules.auth.AuthProvider,
      null,
      h(
        modules.project.ProjectProvider,
        null,
        h(modules.machines.MachinesProvider, null, h(modules.router.RouterProvider, { router })),
      ),
    ),
  );
  await settle();
  return router;
}

/** What a reader sees: the text outside every `hidden` subtree. */
function visibleText(): string {
  const copy = document.body.cloneNode(true) as HTMLElement;
  for (const hidden of copy.querySelectorAll("[hidden]")) hidden.remove();
  return copy.textContent ?? "";
}

const reconnectPosts = (requests: readonly FetchRequest[]) =>
  requests.filter((r) => r.method === "POST" && r.path.endsWith("/reconnect"));

describe("a conversation's history that could not be read", () => {
  it("names the machine and its reconnect with Go to Machines under it, and keeps the transport's error in the fold", async () => {
    server("waiting");
    const modules = await fresh();
    modules.sessionMachines.rememberSessionMachine(SESSION, MACHINE);
    await open(modules, vi.fn());
    const words = modules.en.chat.machineAway;
    await waitFor(() => visibleText().includes(words.reconnecting("box")));

    expect(document.querySelector("[data-retry-phase]")?.getAttribute("data-retry-phase")).toBe(
      "waiting",
    );
    expect(document.querySelector("[data-retry-countdown]")).not.toBeNull();
    expect(
      document
        .querySelector("[data-retry-phase]")!
        .compareDocumentPosition(button(words.openMachines)),
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(visibleText()).not.toContain(MACHINE);
    expect(visibleText()).not.toContain("SOCKS");
    expect(visibleText()).not.toContain(modules.en.chat.historyLoadFailed);

    await click(button(words.details));
    expect(visibleText()).toContain(TRANSPORT_ERROR);
  });

  it("asks the server to try the machine now, and follows its answer; a refusal can be pressed again", async () => {
    const s = server("waiting");
    const modules = await fresh();
    modules.sessionMachines.rememberSessionMachine(SESSION, MACHINE);
    await open(modules, vi.fn());
    const retryNow = modules.en.machines.retry.retryNow;
    await waitFor(() => visibleText().includes(retryNow));

    s.state.refuseRetry = true;
    await click(button(retryNow));
    expect(reconnectPosts(s.fetch.requests)).toHaveLength(1);
    expect(button(retryNow).disabled).toBe(false);

    s.state.refuseRetry = false;
    await click(button(retryNow));
    expect(reconnectPosts(s.fetch.requests)).toHaveLength(2);
    expect(document.querySelector("[data-retry-phase]")?.getAttribute("data-retry-phase")).toBe(
      "trying",
    );
  });

  it("asks the server to stop retrying, and follows its answer to stopped, offering Retry", async () => {
    const s = server("waiting");
    const modules = await fresh();
    modules.sessionMachines.rememberSessionMachine(SESSION, MACHINE);
    await open(modules, vi.fn());
    const r = modules.en.machines.retry;
    await waitFor(() => visibleText().includes(r.stop));

    await click(button(r.stop));
    expect(
      s.fetch.requests.filter((q) => q.method === "POST" && q.path.endsWith("/stop-reconnecting")),
    ).toHaveLength(1);
    await waitFor(() => visibleText().includes(r.cancelled));
    expect(document.querySelector("[data-retry-phase]")?.getAttribute("data-retry-phase")).toBe(
      "cancelled",
    );
    expect(button(r.retry).disabled).toBe(false);
    expect(visibleText()).not.toContain(r.stop);
  });

  it("reads the history again on its own once the machine is connected, once", async () => {
    const s = server("trying");
    const modules = await fresh();
    modules.sessionMachines.rememberSessionMachine(SESSION, MACHINE);
    const onRetry = vi.fn();
    await open(modules, onRetry);
    await waitFor(() => visibleText().includes(modules.en.chat.machineAway.reconnecting("box")));
    expect(onRetry).not.toHaveBeenCalled();

    s.state.link = "connected";
    modules.machines.publishMachinesChanged();
    await waitFor(() => onRetry.mock.calls.length > 0);
    modules.machines.publishMachinesChanged();
    await settle();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("says a stopped machine's server is stopped, and Go to Machines opens the Machines page", async () => {
    server("stopped");
    const modules = await fresh();
    modules.sessionMachines.rememberSessionMachine(SESSION, MACHINE);
    const router = await open(modules, vi.fn());
    const words = modules.en.chat.machineAway;
    await waitFor(() => visibleText().includes(words.stopped("box")));

    expect(document.querySelector("[data-retry-phase]")).toBeNull();
    expect(visibleText()).not.toContain(MACHINE);
    await click(button(words.openMachines));
    expect(router.state.location.pathname).toBe("/machines");
  });

  it("shows the read's own error with a Retry for a conversation on this server", async () => {
    server("waiting");
    const modules = await fresh();
    const onRetry = vi.fn();
    await open(modules, onRetry);
    await waitFor(() => visibleText().includes(modules.en.chat.historyLoadFailed));

    expect(visibleText()).toContain(TRANSPORT_ERROR);
    expect(document.querySelector("[data-retry-phase]")).toBeNull();
    await click(button(modules.en.common.retry));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
