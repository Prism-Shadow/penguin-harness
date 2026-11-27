// @vitest-environment jsdom
/**
 * Opening a conversation on a machine the hub cannot reach: the conversation's reads
 * (features/chat/use-session-stream.ts, held while the machine is known to be down) and the
 * offline view in their place (features/chat/offline-session-history.tsx). The history and live
 * streams are the boundary this suite fakes (api/sse.ts); the machines account is the test's.
 *
 * - Given a machine the machines account reads as away, opening its conversation asks the machine
 *   nothing — no history read of it, no live subscription — and the offline line shows at once
 *   over what the hub holds; when the account pushes the machine back, the conversation opens,
 *   once.
 * - Given a read that gave up on a machine the account reads as connected (its server out of
 *   reach: `machine_unreachable`), the offline line says the server is not responding, with a
 *   Retry; the machine's API socket coming up reads again once, a socket fact that did not change
 *   does not, and Retry reads again.
 * - Given a reachable machine, the conversation opens as before: its reads start at once, and a
 *   wait the hub reports while the machine drops mid-load stays on the loading row (no offline
 *   view, no cached read) until the read gives up.
 */
import { createElement as h } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  HistoryStreamError,
  MachineInfo,
  MachinesResponse,
} from "@prismshadow/penguin-server/api";
import type { HistoryStreamHandlers, HistoryStreamQuery } from "../src/api/sse";
import {
  OfflineSessionHistory,
  useMachineHold,
  useOfflineSessionHistory,
} from "../src/features/chat/offline-session-history";
import { useSessionStream } from "../src/features/chat/use-session-stream";
import { forgetSessionMachines, rememberSessionMachine } from "../src/lib/session-machines";
import { S } from "../src/lib/strings";
import { button, click, mount, run, settle, unmountAll } from "./helpers/dom";

interface Read {
  query: HistoryStreamQuery;
  handlers: HistoryStreamHandlers;
}

const streams = vi.hoisted(() => ({ history: [] as Read[], live: 0 }));
vi.mock("../src/api/sse", async (original) => ({
  ...(await original<typeof import("../src/api/sse")>()),
  openHistoryStream: (_sid: string, query: HistoryStreamQuery, handlers: HistoryStreamHandlers) => {
    streams.history.push({ query, handlers });
    return { close: () => undefined };
  },
  openSessionStream: () => {
    streams.live += 1;
    return { close: () => undefined };
  },
  openTraceBodyStream: () => ({ close: () => undefined }),
}));

const account = vi.hoisted(() => ({ machines: [] as MachineInfo[] }));
vi.mock("../src/state/machines", async (original) => ({
  ...(await original<typeof import("../src/state/machines")>()),
  useMachines: () => ({
    state: {
      machines: account.machines,
      imageVersion: null,
      job: null,
    } as unknown as MachinesResponse,
    settled: true,
    error: null,
    refresh: async () => {},
    accept: () => {},
  }),
}));

const SESSION = "remote";
const MACHINE = "box";
const words = S.chat.offlineHistory;

/** The machine as the account lists it: connected and installed, unless `over` says otherwise. */
const machine = (over: Partial<MachineInfo> = {}): MachineInfo =>
  ({
    id: "ssh:studio",
    alias: "studio",
    machineId: MACHINE,
    member: true,
    local: false,
    installed: { version: "1", at: "2026-11-01T00:00:00Z" },
    connection: { pid: 1 },
    keepConnected: true,
    socket: null,
    api: null,
    status: null,
    root: "/data",
    ...over,
  }) as MachineInfo;

/** The hub's word that the read stopped waiting: the retries ran out, the machine's server unreached. */
const gaveUp: HistoryStreamError = {
  code: "machine_unreachable",
  message: "The server on the machine holding this conversation cannot be reached.",
  details: { machineId: MACHINE, reason: "unreachable" },
};
const noCopy: HistoryStreamError = { code: "history_cache_miss", message: "No saved window." };

/** The conversation's place on the chat page, wired as the page wires it. */
function Conversation() {
  const hold = useMachineHold("p", "u", SESSION, null);
  const stream = useSessionStream(SESSION, "idle", () => {}, "page", hold);
  const offline = useOfflineSessionHistory("p", "u", SESSION, stream, stream.model.items);
  return offline ? h(OfflineSessionHistory, offline) : h("p", null, "live");
}

const reads = (kind: HistoryStreamQuery["kind"]) =>
  streams.history.filter((read) => read.query.kind === kind);

beforeEach(() => {
  streams.history = [];
  streams.live = 0;
  rememberSessionMachine(SESSION, MACHINE);
});
afterEach(async () => {
  await unmountAll();
  forgetSessionMachines();
  account.machines = [];
});

describe("a conversation on a machine the hub cannot reach", () => {
  it("asks a machine known to be down nothing, says so at once, and opens once the account pushes it back", async () => {
    account.machines = [machine({ connection: null })];
    const ui = await mount(h(Conversation));
    await settle();
    expect(streams.history.map((read) => read.query.kind)).toEqual(["cached"]);
    expect(streams.live).toBe(0);
    await run(() => reads("cached")[0]!.handlers.onError(noCopy));
    expect(ui.container.textContent).toContain(words.disconnected("studio"));
    expect(ui.container.textContent).toContain(words.miss);

    account.machines = [machine({ connection: { pid: 2 } })];
    await ui.rerender(h(Conversation));
    await settle();
    expect(streams.live).toBe(1);
    expect(reads("tail")).toHaveLength(1);
    expect(ui.container.textContent).toBe("live");
  });

  it("falls back to the offline line with a Retry when a read gives up, and reads again when the socket comes up or on Retry", async () => {
    account.machines = [
      machine({ socket: { state: "failed", since: "2026-11-26T10:00:00.000Z" } }),
    ];
    const ui = await mount(h(Conversation));
    await settle();
    expect(streams.live).toBe(1);
    expect(reads("tail")).toHaveLength(1);

    await run(() => reads("tail")[0]!.handlers.onError(gaveUp));
    await run(() => reads("cached")[0]!.handlers.onError(noCopy));
    expect(ui.container.textContent).toContain(words.unreachable("studio"));
    expect(ui.container.textContent).toContain(words.miss);
    // The account read again with nothing changed about the socket: no reason to ask.
    account.machines = [
      machine({ socket: { state: "failed", since: "2026-11-26T10:00:00.000Z" } }),
    ];
    await ui.rerender(h(Conversation));
    await settle();
    expect(reads("tail")).toHaveLength(1);

    account.machines = [
      machine({ socket: { state: "connected", since: "2026-11-26T10:05:00.000Z" } }),
    ];
    await ui.rerender(h(Conversation));
    await settle();
    expect(reads("tail")).toHaveLength(2);

    // Given up again with the socket still up since then: only a press reads again.
    await run(() => reads("tail")[1]!.handlers.onError(gaveUp));
    expect(reads("tail")).toHaveLength(2);
    await click(button(S.common.retry));
    expect(reads("tail")).toHaveLength(3);
  });

  it("opens a conversation on a reachable machine as before, and keeps a mid-load wait on the loading row", async () => {
    account.machines = [machine()];
    const ui = await mount(h(Conversation));
    await settle();
    expect(streams.live).toBe(1);
    expect(streams.history.map((read) => read.query.kind)).toEqual(["tail"]);

    await run(() =>
      reads("tail")[0]!.handlers.onProgress?.({
        phase: "window",
        machineId: MACHINE,
        doneBytes: 0,
        totalBytes: 0,
        doneLines: 0,
        totalLines: 0,
        waiting: { reason: "unreachable", attempt: 2, maxAttempts: 5, nextAt: Date.now() + 2_000 },
      }),
    );
    expect(ui.container.textContent).toBe("live");
    expect(reads("cached")).toHaveLength(0);
  });
});
