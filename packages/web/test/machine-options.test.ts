/**
 * The employee machine picker (features/company/machine-options.ts): option building
 * from a machines listing, and the stored-vs-picked comparison behind the dialog's
 * dirty bit.
 */
import { describe, expect, it } from "vitest";
import { machineDirty, machineOptions } from "../src/features/company/machine-options";

describe("machineOptions", () => {
  it("always offers this server first, then connected remotes disabled", () => {
    expect(
      machineOptions([
        { alias: "jchl254", local: true, machineId: "s25ffaJHXjvUgWSX" },
        { alias: "gpu-box", local: false, machineId: "AbC123xYz0123456" },
        { alias: "never-started", local: false, machineId: null },
      ]),
    ).toEqual([
      { value: "", alias: "jchl254", disabled: false },
      { value: "AbC123xYz0123456", alias: "gpu-box", disabled: true },
    ]);
  });

  it("offers this server alone when no remote ever started there", () => {
    expect(machineOptions([])).toEqual([{ value: "", alias: "local", disabled: false }]);
  });
});

describe("machineDirty", () => {
  it("treats absent, empty and local as the same unpinned state", () => {
    expect(machineDirty(undefined, "")).toBe(false);
    expect(machineDirty("local", "")).toBe(false);
    expect(machineDirty(undefined, "local")).toBe(false);
    expect(machineDirty("local", "local")).toBe(false);
  });

  it("spots a pin being set, moved or cleared", () => {
    expect(machineDirty(undefined, "AbC123xYz0123456")).toBe(true);
    expect(machineDirty("AbC123xYz0123456", "")).toBe(true);
    expect(machineDirty("AbC123xYz0123456", "local")).toBe(true);
    expect(machineDirty("aaa", "bbb")).toBe(true);
    expect(machineDirty("aaa", "aaa")).toBe(false);
  });
});
