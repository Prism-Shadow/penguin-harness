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
  origin: null,
  status: null,
  ...over,
});

const state = (machines: MachineInfo[]): MachinesResponse => ({
  machines,
  imageVersion: "9.9.9",
  job: null,
  connect: null,
});

const here = machine({
  alias: "workstation",
  id: "local",
  local: true,
  machineId: "LOCALaaaaaaaaaa",
});
const connected = machine({
  alias: "far-box",
  machineId: "noeSE0FFHhNXl2J5",
  origin: "http://localhost:7364",
});

describe("workspaceMachines", () => {
  it("is empty before the list has loaded", () => {
    expect(workspaceMachines(null)).toEqual([]);
  });

  it("always offers this machine, as the null id the registry stores for it", () => {
    expect(workspaceMachines(state([here]))).toEqual([
      { id: null, label: "workstation", local: true },
    ]);
  });

  it("offers a connected machine by its own id, labelled by its alias", () => {
    expect(workspaceMachines(state([here, connected]))).toEqual([
      { id: null, label: "workstation", local: true },
      { id: "noeSE0FFHhNXl2J5", label: "far-box", local: false },
    ]);
  });

  it("leaves out a machine with no live tunnel — there is no route to browse over", () => {
    const installed = machine({ alias: "cold", machineId: "COLDaaaaaaaaaaaa" });
    expect(workspaceMachines(state([here, installed])).map((m) => m.label)).toEqual([
      "workstation",
    ]);
  });

  it("leaves out a connected machine with no identity: it could never be matched back", () => {
    const nameless = machine({ alias: "ghost", origin: "http://localhost:7365" });
    expect(workspaceMachines(state([here, nameless])).map((m) => m.label)).toEqual(["workstation"]);
  });
});

describe("machineLabel", () => {
  const machines = workspaceMachines(state([here, connected]));

  it("names this machine and a connected one", () => {
    expect(machineLabel(machines, null)).toBe("workstation");
    expect(machineLabel(machines, "noeSE0FFHhNXl2J5")).toBe("far-box");
  });

  it("falls back to the raw id for a machine that is gone, rather than inventing a name", () => {
    // A workspace can outlive the connection it was picked over; showing the id is honest.
    expect(machineLabel(machines, "GONEaaaaaaaaaaaa")).toBe("GONEaaaaaaaaaaaa");
  });
});

describe("isElsewhere", () => {
  it("treats absent and null alike — an entry with no machine is one picked here", () => {
    // Every entry registered before workspaces could name a machine has no machineId, and
    // must keep reading as local rather than as unknown.
    expect(isElsewhere(null, null)).toBe(false);
    expect(isElsewhere(undefined as unknown as null, null)).toBe(false);
  });

  it("is true when the workspace's machine is not the one being worked on", () => {
    expect(isElsewhere("noeSE0FFHhNXl2J5", null)).toBe(true);
    expect(isElsewhere(null, "noeSE0FFHhNXl2J5")).toBe(true);
    expect(isElsewhere("noeSE0FFHhNXl2J5", "noeSE0FFHhNXl2J5")).toBe(false);
  });
});

describe("recordedMachineId", () => {
  it("records nothing for this machine, so 'here' stays the absent case", () => {
    expect(recordedMachineId({ id: null, label: "workstation", local: true })).toBeUndefined();
    expect(recordedMachineId(undefined)).toBeUndefined();
  });

  it("records the id for another machine", () => {
    expect(recordedMachineId({ id: "noeSE0FFHhNXl2J5", label: "far-box", local: false })).toBe(
      "noeSE0FFHhNXl2J5",
    );
  });
});
