/** @vitest-environment jsdom */
import { createElement } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { MachineInfo, MachinesResponse } from "@prismshadow/penguin-server/api";
import { useOfflineSessionHistory } from "@prismshadow/penguin-library-session/web/chat/offline-session-history";
import { forgetSessionMachines, rememberSessionMachine } from "../src/lib/session-machines";
import { mount, unmountAll } from "./helpers/dom";

const { open, machineList } = vi.hoisted(() => ({
  open: vi.fn(() => ({ close: vi.fn() })),
  machineList: { machines: [] as MachineInfo[] },
}));
vi.mock("../src/api/sse", async (original) => ({
  ...(await original<typeof import("../src/api/sse")>()),
  openHistoryStream: open,
}));
vi.mock("../src/state/machines", () => ({
  useMachines: () => ({ state: machineList as MachinesResponse, settled: true }),
}));

type Stream = Parameters<typeof useOfflineSessionHistory>[3];
const reconnect = vi.fn();
const transfer: Stream["transfer"] = { window: null, older: null, fill: null };
const empty: never[] = [];
function Display({ session, stream }: { session: string; stream: Stream }) {
  const reading = useOfflineSessionHistory("p", "u", session, stream, empty);
  return createElement("div", {}, reading?.alias ?? "live");
}
const streamFor = (sessionId: string): Stream => ({
  sessionId,
  historyMachineId: null,
  loading: true,
  error: null,
  errorCause: null,
  reconnect,
  retry: () => {},
  held: false,
  transfer,
});

beforeEach(() => {
  open.mockClear();
  reconnect.mockClear();
  rememberSessionMachine("remote", "box");
});
afterEach(async () => {
  await unmountAll();
  forgetSessionMachines();
  machineList.machines = [];
});

it("believes a session's confirmed disconnect even while the machine list still shows a connection", async () => {
  machineList.machines = [
    { machineId: "box", alias: "studio", connection: { pid: 1 }, local: false },
  ] as MachineInfo[];
  forgetSessionMachines();
  const stream = { ...streamFor("remote"), historyMachineId: "box" };
  const ui = await mount(createElement(Display, { session: "remote", stream }));
  expect(ui.container.textContent).toBe("live");
  const waiting: Stream["transfer"]["window"] = {
    phase: "window",
    machineId: "box",
    doneBytes: 0,
    totalBytes: 0,
    doneLines: 0,
    totalLines: 0,
    waiting: { reason: "not_connected", attempt: 1, maxAttempts: 5, nextAt: 0 },
  };
  await ui.rerender(
    createElement(Display, {
      session: "remote",
      stream: { ...stream, transfer: { ...transfer, window: waiting } },
    }),
  );
  expect(ui.container.textContent).toBe("studio");
  expect(open).toHaveBeenCalledWith("remote", { kind: "cached" }, expect.anything(), "box");
});

it("keeps a local conversation live when the machine list contains an uninstalled entry", async () => {
  machineList.machines = [
    { machineId: null, alias: "unused", connection: null, local: false },
  ] as MachineInfo[];
  const ui = await mount(createElement(Display, { session: "here", stream: streamFor("here") }));
  expect(ui.container.textContent).toBe("live");
  expect(open).not.toHaveBeenCalled();
});

it("keeps the open transcript on disconnect and starts fresh subscriptions once upon reconnection", async () => {
  const machine = {
    machineId: "box",
    alias: "studio",
    connection: null,
    local: false,
  } as MachineInfo;
  machineList.machines = [machine];
  const stream = { ...streamFor("remote"), loading: false };
  const ui = await mount(createElement(Display, { session: "remote", stream }));
  expect(ui.container.textContent).toBe("studio");
  expect(open).not.toHaveBeenCalled();
  machineList.machines = [{ ...machine, connection: { pid: 1 } } as MachineInfo];
  await ui.rerender(createElement(Display, { session: "remote", stream }));
  await ui.rerender(createElement(Display, { session: "remote", stream }));
  expect(reconnect).toHaveBeenCalledTimes(1);
});
