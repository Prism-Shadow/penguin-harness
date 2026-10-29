// @vitest-environment jsdom
/**
 * The transcript's place while a conversation's history loads, and the line at its top while a
 * read runs behind it (features/chat/history-loading.tsx).
 *
 * - Given a conversation on a machine, the skeleton stands for the first second — a fast read
 *   never flashes anything else — and then the transfer row names the machine and says how far
 *   the messages have come: the amount against the whole, and a bar with the same reading.
 * - Given the machines account not answered yet, the skeleton stays past that second, and the row
 *   that follows names the machine from its first frame: its words never change when the name
 *   arrives.
 * - Given the hub waiting for a machine that is not connected, the row under the transfer row
 *   says the connection was lost and is being made again; given a machine that is connected but
 *   silent, it says the machine is being asked again. Retry now reads the window again.
 * - Given a conversation on this server, whose reads report no progress, the skeleton stays.
 * - Given an older window read behind the transcript, the line at its top says nothing for its
 *   first second, then how far the window has come, and goes when the read does.
 */
import { createElement as h } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  HistoryProgress,
  MachineInfo,
  MachinesResponse,
} from "@prismshadow/penguin-server/api";
import { HistoryLoading, HistoryTransferLine } from "../src/features/chat/history-loading";
import { S } from "../src/lib/strings";
import type { MachinesAccount } from "../src/state/machines";
import { button, click, mount, run, unmountAll } from "./helpers/dom";

/** The live machines account the rows read, as the test sets it. */
const machines = vi.hoisted(() => ({ account: null as MachinesAccount | null }));
vi.mock("../src/state/machines", async (importActual) => {
  const actual = await importActual<typeof import("../src/state/machines")>();
  return { ...actual, useMachines: () => machines.account! };
});

/** The account once it has answered: machine `m1`, connected, under the alias `box`. */
function answered(): MachinesAccount {
  const machine = {
    id: "ssh:box",
    alias: "box",
    machineId: "m1",
    member: true,
    local: false,
    connection: { pid: 1 },
    keepConnected: true,
    api: null,
    status: null,
  } as unknown as MachineInfo;
  const state = {
    machines: [machine],
    imageVersion: null,
    job: null,
  } as unknown as MachinesResponse;
  return { state, settled: true, error: null, refresh: async () => {}, accept: () => {} };
}

const unanswered = (): MachinesAccount => ({
  state: null,
  settled: false,
  error: null,
  refresh: async () => {},
  accept: () => {},
});

beforeEach(() => {
  // Fake time that also moves with real time: the DOM helpers settle on a zero-delay timer.
  vi.useFakeTimers({ shouldAdvanceTime: true });
  machines.account = answered();
});
afterEach(async () => {
  await unmountAll();
  vi.useRealTimers();
});

const KIB = 1024;
const progress = (waiting: HistoryProgress["waiting"] = null): HistoryProgress => ({
  phase: "window",
  machineId: "m1",
  doneBytes: 120 * KIB,
  totalBytes: 380 * KIB,
  doneLines: 40,
  totalLines: 120,
  waiting,
});

const bar = (container: HTMLElement) => container.querySelector('[role="progressbar"]');
const words = S.chat.historyTransfer;

describe("the transcript's place while history loads", () => {
  it("shows the skeleton for a second, then names the machine and how far its messages have come", async () => {
    const { container } = await mount(
      h(HistoryLoading, {
        projectId: "p",
        sessionId: "s1",
        progress: progress(),
        onRetryNow: () => {},
      }),
    );
    expect(bar(container)).toBeNull();
    await run(() => vi.advanceTimersByTime(1_000));
    expect(container.textContent).toContain(words.window("box"));
    expect(container.textContent).toContain("120 / 380 KB");
    expect(bar(container)?.getAttribute("aria-valuenow")).toBe(String(120 * KIB));
    expect(bar(container)?.getAttribute("aria-valuemax")).toBe(String(380 * KIB));
  });

  it("waits for the machines account before the row, so the machine is named from its first frame", async () => {
    machines.account = unanswered();
    // A fresh element per render, as a parent re-rendering on the account's change makes.
    const element = () =>
      h(HistoryLoading, {
        projectId: "p",
        sessionId: "s1",
        progress: progress(),
        onRetryNow: () => {},
      });
    const { container, rerender } = await mount(element());
    await run(() => vi.advanceTimersByTime(3_000));
    expect(bar(container)).toBeNull();
    expect(container.textContent).not.toContain(words.window(null));
    machines.account = answered();
    await rerender(element());
    expect(container.textContent).toContain(words.window("box"));
  });

  it.each([
    ["not_connected", words.reconnecting(2), words.asking(2)],
    ["retrying", words.asking(2), words.reconnecting(2)],
  ] as const)(
    "says how the link stands while the hub waits (%s), and Retry now reads the window again",
    async (reason, said, notSaid) => {
      const onRetryNow = vi.fn();
      // The attempt is due: the row says what it is doing rather than counting down.
      const waiting = { reason, attempt: 2, nextAt: Date.now() - 1 };
      const { container } = await mount(
        h(HistoryLoading, {
          projectId: "p",
          sessionId: "s1",
          progress: progress(waiting),
          onRetryNow,
        }),
      );
      await run(() => vi.advanceTimersByTime(1_000));
      expect(container.textContent).toContain(said);
      expect(container.textContent).not.toContain(notSaid);
      await click(button(words.retryNow));
      expect(onRetryNow).toHaveBeenCalledTimes(1);
    },
  );

  it("keeps the skeleton for a conversation on this server", async () => {
    const { container } = await mount(
      h(HistoryLoading, { projectId: "p", sessionId: "s1", progress: null, onRetryNow: () => {} }),
    );
    await run(() => vi.advanceTimersByTime(5_000));
    expect(bar(container)).toBeNull();
    expect(container.textContent).toBe("");
  });
});

describe("the line at the transcript's top while a read runs behind it", () => {
  it("says nothing for a second, then how far the older window has come, and goes with the read", async () => {
    const reading = h(HistoryTransferLine, { loading: true, older: progress(), fill: null });
    const { container, rerender } = await mount(reading);
    await run(() => vi.advanceTimersByTime(900));
    expect(container.textContent).toBe("");
    await run(() => vi.advanceTimersByTime(100));
    expect(container.textContent).toContain(S.chat.loadingEarlier);
    expect(container.textContent).toContain("120 / 380 KB");
    await rerender(h(HistoryTransferLine, { loading: false, older: null, fill: null }));
    expect(container.textContent).toBe("");
  });
});
