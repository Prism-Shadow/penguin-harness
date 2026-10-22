// @vitest-environment jsdom
/**
 * What a conversation, or a new chat, on a machine reads from that machine: its Agent's memory
 * (features/chat/use-memory-listing.ts), its Agent's Skills (features/chat/use-agent-skills.ts)
 * and the models a Session there can take (lib/machine-models.ts).
 *
 * - Given a Session on a machine, its memory listing is read from that machine and nothing is
 *   asked of this server; the same Agent id on this server is another Agent, so its listing never
 *   stands in for the machine's while the page moves between them.
 * - Given a Session on a machine, the Skills its composer offers are read from that machine and
 *   nothing is asked of this server.
 * - Given the page moving between a Session here and one on a machine, the Skills shown are
 *   cleared at once, and an answer for the Session left behind is dropped.
 * - Given the Skills read failing, the composer offers none and the read counts as settled.
 * - Given a page acting on a connected machine, the machine's models are offered; a page acting
 *   on this server asks the machine nothing.
 * - Given the machine coming back, nothing is asked while it reconnects, and its models arrive
 *   as soon as the server says it is connected.
 * - Given the page leaving the machine's workspace and returning to it, the machine's last
 *   answer is offered at once while it is asked again.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement as h } from "react";
import type {
  MachineInfo,
  MachinesResponse,
  ModelInfo,
  ModelsResponse,
} from "@prismshadow/penguin-server/api";
import { useAgentSkills } from "../src/features/chat/use-agent-skills";
import {
  forgetSessionMachines,
  machineForSession,
  rememberSessionMachine,
} from "../src/lib/session-machines";
import { ADMIN_ME } from "./helpers/admin-settings";
import { mount, settle, unmountAll } from "./helpers/dom";
import { apiError, json, stubFetch } from "./helpers/fetch";
import type { FetchRequest } from "./helpers/fetch";

const PROJECT = "proj";
const AGENT = "helper";
const MACHINE = "QS7J4YVgSovi-Z2c";
/** The conversation's memory changes: none, and the same array every render, as chat-page passes it. */
const NO_CHANGES: never[] = [];

afterEach(async () => {
  await unmountAll();
  localStorage.clear();
});

describe("a Session's memory on a machine", () => {
  type Listing = typeof import("../src/features/chat/use-memory-listing");

  function memoryServer() {
    const answer = (request: FetchRequest) => {
      const where = request.machine ?? "here";
      const base = `/api/projects/${PROJECT}/agents/${AGENT}/memory`;
      if (request.path === base) {
        return json({
          enabled: true,
          templateHasMemory: true,
          memoryDir: `/data/${where}/memory`,
          scopes: [{ scopeKey: "user", kind: "user", fileCount: 1, hasIndex: true }],
        });
      }
      if (request.path === `${base}/scopes/user/files`) {
        return json({
          scopeKey: "user",
          files: [{ name: `${where}-note.md`, description: "", type: "user", size: 1 }],
        });
      }
      return apiError(404, "not_found");
    };
    let held: Array<() => void> | null = null;
    const fetch = stubFetch(async (request) => {
      if (held !== null) await new Promise<void>((resolve) => held!.push(resolve));
      return answer(request);
    });
    return {
      fetch,
      hold() {
        held = [];
      },
      async release() {
        const waiting = held ?? [];
        held = null;
        for (const open of waiting) open();
        await settle();
      },
    };
  }

  async function visit(listing: Listing, machineId: string | null) {
    function Probe({ machine }: { machine: string | null }) {
      const { scopes } = listing.useMemoryListing(PROJECT, AGENT, machine, true, NO_CHANGES);
      return h(
        "p",
        null,
        scopes === null
          ? "—"
          : scopes
              .flatMap((s) => s.files)
              .map((f) => f.name)
              .join(","),
      );
    }
    const mounted = await mount(h(Probe, { machine: machineId }));
    await settle();
    return {
      text: () => mounted.container.textContent,
      move: async (machine: string | null) => {
        await mounted.rerender(h(Probe, { machine }));
        await settle();
      },
    };
  }

  it("reads the memory of the machine the Session is on, and never stands one server's in for the other's", async () => {
    const server = memoryServer();
    const listing = await import("../src/features/chat/use-memory-listing");
    const page = await visit(listing, MACHINE);
    expect(page.text()).toBe(`${MACHINE}-note.md`);
    expect(server.fetch.requests.every((r) => r.machine === MACHINE)).toBe(true);

    // The same Agent id on this server is another Agent: while its listing is on the way, the
    // machine's is not shown in its place.
    server.hold();
    await page.move(null);
    expect(page.text()).toBe("—");
    await server.release();
    expect(page.text()).toBe("here-note.md");
  });
});

describe("a Session's Skills on a machine", () => {
  const SKILLS = `/api/projects/${PROJECT}/agents/${AGENT}/skills`;

  afterEach(() => forgetSessionMachines());

  /**
   * Every server answers with one Skill named after itself ("here" for this one). Once held,
   * each read waits until the test answers for its server, in any order.
   */
  function skillsServer() {
    const waiting = new Map<string, () => void>();
    let holding = false;
    let failing = false;
    const fetch = stubFetch(async (request) => {
      const where = request.machine ?? "here";
      if (holding) await new Promise<void>((resolve) => waiting.set(where, resolve));
      if (failing) return apiError(500, "internal_error");
      return request.path === SKILLS
        ? json({ skills: [{ name: `${where}-skill`, description: "", version: "" }] })
        : apiError(404, "not_found");
    });
    return {
      fetch,
      hold() {
        holding = true;
      },
      fail() {
        failing = true;
      },
      async answer(where: string) {
        waiting.get(where)?.();
        waiting.delete(where);
        await settle();
      },
    };
  }

  /** A composer on `sessionId`'s Agent, printing the Skills it offers and whether the read settled. */
  async function visit(sessionId: string) {
    function Probe({ session }: { session: string }) {
      const { skills, loaded } = useAgentSkills(PROJECT, AGENT, machineForSession(session));
      return h(
        "p",
        null,
        `${skills.map((s) => s.name).join(",")}|${loaded ? "settled" : "reading"}`,
      );
    }
    const mounted = await mount(h(Probe, { session: sessionId }));
    await settle();
    return {
      text: () => mounted.container.textContent,
      open: async (session: string) => {
        await mounted.rerender(h(Probe, { session }));
        await settle();
      },
    };
  }

  it("reads the Skills of the Agent on the Session's machine, and asks this server nothing", async () => {
    const server = skillsServer();
    rememberSessionMachine("s-far", MACHINE);
    const page = await visit("s-far");
    expect(page.text()).toBe(`${MACHINE}-skill|settled`);
    expect(server.fetch.requests.map((r) => [r.machine, r.path])).toEqual([[MACHINE, SKILLS]]);
  });

  it("clears the Skills shown on a move between servers, and drops an answer for the Session left behind", async () => {
    const server = skillsServer();
    rememberSessionMachine("s-far", MACHINE);
    server.hold();
    const page = await visit("s-here");
    await server.answer("here");
    expect(page.text()).toBe("here-skill|settled");

    // This server's Agent of the same id is another Agent: its Skills are gone at once.
    await page.open("s-far");
    expect(page.text()).toBe("|reading");

    // Back before the machine answered: its answer, arriving now, is not this Session's.
    await page.open("s-here");
    await server.answer(MACHINE);
    expect(page.text()).toBe("|reading");
    await server.answer("here");
    expect(page.text()).toBe("here-skill|settled");
  });

  it("offers no Skills when the read fails, and counts the read as settled", async () => {
    const server = skillsServer();
    server.fail();
    rememberSessionMachine("s-far", MACHINE);
    const page = await visit("s-far");
    expect(page.text()).toBe("|settled");
  });
});

describe("the models a page on a machine offers", () => {
  /** The hook and the providers around it, from one module graph (they share contexts). */
  interface Modules {
    models: typeof import("../src/lib/machine-models");
    machines: typeof import("../src/state/machines");
    auth: typeof import("../src/state/auth");
    project: typeof import("../src/state/project");
  }

  const model = (modelId: string): ModelInfo => ({ provider: "custom", modelId }) as ModelInfo;
  const models = (...ids: string[]): ModelsResponse => ({
    providers: {},
    models: ids.map(model),
    defaultModel: { provider: "custom", modelId: ids[0]! },
  });

  /** The Project's machine list with the one machine in the state the test sets. */
  function machineList(state: "connected" | "reconnecting"): MachinesResponse {
    const machine = {
      id: "ssh:box",
      alias: "box",
      machineId: MACHINE,
      installed: { version: "0.2.16", at: "2026-10-15T00:00:00.000Z" },
      local: false,
      connection: state === "connected" ? { pid: 1 } : null,
      ...(state === "reconnecting"
        ? { reconnect: { since: "2026-10-15T00:00:00.000Z", attempts: 1, nextAt: null } }
        : {}),
      api: null,
      root: "~/.penguin/data",
      status: null,
    } as unknown as MachineInfo;
    return {
      machines: [machine],
      imageVersion: "0.2.16",
      job: null,
    } as unknown as MachinesResponse;
  }

  /** A fresh copy of the modules, so one test's remembered answers never seed another's. */
  async function fresh(): Promise<Modules> {
    vi.resetModules();
    return {
      models: await import("../src/lib/machine-models"),
      machines: await import("../src/state/machines"),
      auth: await import("../src/state/auth"),
      project: await import("../src/state/project"),
    };
  }

  function server() {
    const state = { link: "connected" as "connected" | "reconnecting", models: models("m-1") };
    /** Model reads waiting for {@link release}, while the test holds them. */
    let held: Array<() => void> | null = null;
    const fetch = stubFetch(async (request) => {
      if (request.path === "/api/me") return json(ADMIN_ME);
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
      if (request.path === `/api/projects/${PROJECT}/machines`) {
        return json(machineList(state.link));
      }
      if (request.path === `/api/projects/${PROJECT}/models` && request.machine === MACHINE) {
        const answer = state.models;
        if (held !== null) await new Promise<void>((resolve) => held!.push(resolve));
        return json(answer);
      }
      if (request.path === "/api/me/prefs") return json({ prefs: {} });
      return apiError(404, "not_found");
    });
    return {
      state,
      fetch,
      hold() {
        held = [];
      },
      async release() {
        const waiting = held ?? [];
        held = null;
        for (const open of waiting) open();
        await settle();
      },
    };
  }

  async function visit(modules: Modules, machineId: string | null) {
    function Probe({ machine }: { machine: string | null }) {
      const offered = modules.models.useMachineModels(PROJECT, machine);
      return h("p", null, offered === null ? "—" : offered.models.map((m) => m.modelId).join(","));
    }
    const tree = (machine: string | null) =>
      h(
        modules.auth.AuthProvider,
        null,
        h(
          modules.project.ProjectProvider,
          null,
          h(modules.machines.MachinesProvider, null, h(Probe, { machine })),
        ),
      );
    const mounted = await mount(tree(machineId));
    await settle();
    return {
      text: () => mounted.container.textContent,
      move: async (machine: string | null) => {
        await mounted.rerender(tree(machine));
        await settle();
      },
    };
  }

  const modelReads = (requests: readonly FetchRequest[]) =>
    requests.filter((r) => r.path === `/api/projects/${PROJECT}/models`);

  it("offers the connected machine's models, and asks the machine nothing for a page here", async () => {
    const s = server();
    const modules = await fresh();
    const local = await visit(modules, null);
    expect(local.text()).toBe("—");
    expect(modelReads(s.fetch.requests)).toEqual([]);

    await local.move(MACHINE);
    expect(local.text()).toBe("m-1");
    expect(modelReads(s.fetch.requests).map((r) => r.machine)).toEqual([MACHINE]);
  });

  it("waits while the machine reconnects, and reads its models once the server says it is back", async () => {
    const s = server();
    s.state.link = "reconnecting";
    const modules = await fresh();
    const page = await visit(modules, MACHINE);
    expect(page.text()).toBe("—");
    expect(modelReads(s.fetch.requests)).toEqual([]);

    s.state.link = "connected";
    modules.machines.publishMachinesChanged();
    await settle();
    expect(page.text()).toBe("m-1");
  });

  it("offers the machine's last answer at once on the way back, while asking it again", async () => {
    const s = server();
    const modules = await fresh();
    const page = await visit(modules, MACHINE);
    expect(page.text()).toBe("m-1");
    await page.move(null);
    expect(page.text()).toBe("—");

    s.state.models = models("m-2");
    s.hold();
    await page.move(MACHINE);
    expect(page.text()).toBe("m-1");
    await s.release();
    expect(page.text()).toBe("m-2");
    expect(modelReads(s.fetch.requests)).toHaveLength(2);
  });
});
