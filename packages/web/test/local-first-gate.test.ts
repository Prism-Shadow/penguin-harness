// @vitest-environment jsdom
/**
 * The app shell's remote reads wait for this window's own content (lib/local-first.ts): the
 * Session list raises the gate once its first list is on screen.
 *
 * - Given an admin with a connected machine, while this server's Session list is on its way
 *   nothing is asked of the machine; once the list is on screen, the machine's Agents and its
 *   Sessions are read.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement as h } from "react";
import type { MachinesResponse } from "@prismshadow/penguin-server/api";
import { AuthProvider } from "../src/state/auth";
import { ProjectProvider } from "../src/state/project";
import { MachinesProvider } from "../src/state/machines";
import { SessionsProvider, useSessions } from "../src/state/sessions";
import { ADMIN_ME } from "./helpers/admin-settings";
import { mount, settle, unmountAll, waitFor } from "./helpers/dom";
import { apiError, json, stubFetch } from "./helpers/fetch";
import type { FetchRequest } from "./helpers/fetch";

const PROJECT = "proj";

const MACHINES: MachinesResponse = {
  machines: [
    {
      id: "ssh:box",
      alias: "box",
      machineId: "M1",
      installed: { version: "1.0.0", at: "2026-10-26T00:00:00.000Z" },
      local: false,
      connection: { pid: 1 },
      socket: null,
      api: null,
      root: "~/.penguin",
      status: null,
    },
  ],
  imageVersion: null,
  job: null,
  jobs: [],
} as unknown as MachinesResponse;

/** An event stream that never delivers anything: jsdom has no `EventSource`. */
class SilentEventSource {
  readyState = 0;
  onmessage: unknown = null;
  onopen: unknown = null;
  onerror: unknown = null;
  addEventListener(): void {}
  close(): void {}
}

afterEach(async () => {
  await unmountAll();
  vi.unstubAllGlobals();
});

function Probe() {
  const { loading } = useSessions();
  return h("p", null, loading ? "listing" : "listed");
}

describe("the remote reads behind this window's own content", () => {
  it("ask nothing of a connected machine until this server's Session list is on screen", async () => {
    let hold = true;
    const waiting: Array<() => void> = [];
    const answer = (request: FetchRequest): Response => {
      if (request.path === "/api/me") return json(ADMIN_ME);
      if (request.path === "/api/projects") {
        return json({ projects: [{ projectId: PROJECT, role: "owner", ownerUserId: "admin" }] });
      }
      if (request.path === `/api/projects/${PROJECT}/agents`) {
        return json({ agents: [{ agentId: request.machine === null ? "here" : "there" }] });
      }
      if (request.path === `/api/projects/${PROJECT}/machines`) return json(MACHINES);
      if (request.path === `/api/projects/${PROJECT}/sessions/batch`) {
        const entries = (request.body as { requests: Array<{ agentId: string }> }).requests;
        return json({
          results: entries.map(({ agentId }) => ({
            agentId,
            ok: true,
            sessions: [],
            counts: { active: 0, archived: 0 },
          })),
        });
      }
      return apiError(404, "not_found");
    };
    const fetch = stubFetch((request) => {
      const local = request.machine === null && request.path.endsWith("/sessions/batch");
      if (!local || !hold) return answer(request);
      return new Promise<Response>((resolve) => waiting.push(() => resolve(answer(request))));
    });
    vi.stubGlobal("EventSource", SilentEventSource);
    const page = await mount(
      h(
        AuthProvider,
        null,
        h(ProjectProvider, null, h(MachinesProvider, null, h(SessionsProvider, null, h(Probe)))),
      ),
    );
    await waitFor(
      () => waiting.length > 0 && fetch.requests.some((r) => r.path.endsWith("/machines")),
    );
    await settle();
    const asked = () => fetch.requests.filter((r) => r.machine === "M1");
    expect(page.container.textContent).toBe("listing");
    expect(asked()).toEqual([]);

    hold = false;
    for (const go of waiting.splice(0)) go();
    await waitFor(() => asked().some((r) => r.path.endsWith("/agents")));
    await waitFor(() => asked().some((r) => r.path.endsWith("/sessions/batch")));
    expect(page.container.textContent).toBe("listed");
  });
});
