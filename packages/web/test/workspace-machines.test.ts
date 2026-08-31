/**
 * Which machines a workspace can be picked on. A workspace is a directory ON a machine, so
 * the offer has to be exactly the machines whose filesystem can be browsed right now —
 * offering one that cannot be reached would fail at the first click instead of the choice.
 */
import { describe, expect, it } from "vitest";
import type { MachineInfo, MachinesResponse } from "@prismshadow/penguin-server/api";
import {
  isElsewhere,
  machineLabel,
  recordedMachineId,
  workspaceMachines,
} from "../src/lib/workspace-machines";

const machine = (over: Partial<MachineInfo> & { alias: string }): MachineInfo => ({
  id: `ssh:${over.alias}`,
  machineId: null,
  installed: null,
  local: false,
  forward: null,
  api: null,
  status: null,
  ...over,
});

const state = (machines: MachineInfo[]): MachinesResponse => ({
  machines,
  imageVersion: "9.9.9",
  job: null,
});

const INSTALL = { version: "9.9.9", at: "2026-08-24T12:00:00.000Z" };
const here = machine({
  alias: "workstation",
  id: "local",
  local: true,
  machineId: "LOCALaaaaaaaaaa",
});
const connected = machine({
  alias: "far-box",
  machineId: "noeSE0FFHhNXl2J5",
  forward: { localPort: 53000 },
  installed: INSTALL,
});

describe("workspaceMachines", () => {
  const installedNotConnected = machine({
    alias: "cold",
    installed: INSTALL,
    machineId: "COLDaaaaaaaaaaaa",
  });
  const connectedNameless = machine({
    alias: "ghost",
    forward: { localPort: 53000 },
    installed: INSTALL,
  });
  const neverInstalled = machine({ alias: "just-an-ssh-host" });

  it("is empty before the list has loaded", () => {
    expect(workspaceMachines(null)).toEqual([]);
  });

  it("always offers this machine, as the null id the registry stores for it", () => {
    expect(workspaceMachines(state([here]))).toEqual([
      { id: null, label: "workstation", local: true, selectable: true },
    ]);
  });

  it("offers a connected machine by its own id, labelled by its alias", () => {
    expect(workspaceMachines(state([here, connected]))[1]).toEqual({
      id: "noeSE0FFHhNXl2J5",
      label: "far-box",
      local: false,
      selectable: true,
    });
  });

  it("offers an installed machine even with no tunnel — browsing goes over ssh", () => {
    const [, cold] = workspaceMachines(state([here, installedNotConnected]));
    expect(cold).toMatchObject({ label: "cold", selectable: true });
    expect(cold?.reason).toBeUndefined();
  });

  it("lists a connected machine that has no identity yet, with its own reason", () => {
    const [, ghost] = workspaceMachines(state([here, connectedNameless]));
    expect(ghost).toMatchObject({ label: "ghost", selectable: false, reason: "no-identity" });
  });

  it("gives a usable machine no reason at all, so a reason always means a problem", () => {
    for (const entry of workspaceMachines(state([here, connected]))) {
      expect(entry.selectable).toBe(true);
      expect(entry.reason).toBeUndefined();
    }
  });

  it("still leaves out plain ssh hosts — 45 config entries are not 45 failures", () => {
    const listed = workspaceMachines(state([here, neverInstalled, machine({ alias: "another" })]));
    expect(listed.map((m) => m.label)).toEqual(["workstation"]);
  });
});

describe("machineLabel", () => {
  const machines = workspaceMachines(state([here, connected]));

  it("names this machine and a connected one", () => {
    expect(machineLabel(machines, null)).toBe("workstation");
    expect(machineLabel(machines, "noeSE0FFHhNXl2J5")).toBe("far-box");
  });

  it("falls back to the raw id for a machine that is gone, rather than inventing a name", () => {
    expect(machineLabel(machines, "GONEaaaaaaaaaaaa")).toBe("GONEaaaaaaaaaaaa");
  });
});

describe("isElsewhere", () => {
  it("treats absent and null alike — an entry with no machine is one picked here", () => {
    expect(isElsewhere(null)).toBe(false);
    expect(isElsewhere(undefined)).toBe(false);
  });

  it("is true for a workspace that lives on another machine", () => {
    expect(isElsewhere("noeSE0FFHhNXl2J5")).toBe(true);
  });
});

describe("recordedMachineId", () => {
  it("records nothing for this machine, so 'here' stays the absent case", () => {
    expect(
      recordedMachineId({ id: null, label: "workstation", local: true, selectable: true }),
    ).toBeUndefined();
    expect(recordedMachineId(undefined)).toBeUndefined();
  });

  it("records the id for another machine", () => {
    expect(
      recordedMachineId({
        id: "noeSE0FFHhNXl2J5",
        label: "far-box",
        local: false,
        selectable: true,
      }),
    ).toBe("noeSE0FFHhNXl2J5");
  });
});
