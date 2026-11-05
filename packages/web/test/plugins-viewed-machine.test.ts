/**
 * Which machine the Plugins page views (features/plugins/viewed-machine.ts): the picked one
 * while the picker offers it, this server otherwise — so a machine that leaves the choices
 * does not hold the page on it once the picker is gone.
 */
import { describe, expect, it } from "vitest";
import { samePluginTarget, viewedMachine } from "../src/features/plugins/viewed-machine";

const SELF = "self-id";
const GPU = "gpu-id";

describe("viewedMachine", () => {
  it("views this server until a machine is picked", () => {
    expect(viewedMachine(null, [SELF, GPU], SELF)).toBe(SELF);
  });

  it("views the picked machine while the picker offers it", () => {
    expect(viewedMachine(GPU, [SELF, GPU], SELF)).toBe(GPU);
  });

  it("falls back to this server once the picked machine leaves the choices", () => {
    expect(viewedMachine(GPU, [SELF], SELF)).toBe(SELF);
  });

  it("views nothing until this server's id is read", () => {
    expect(viewedMachine(GPU, [], undefined)).toBeUndefined();
  });
});

describe("plugin target identity", () => {
  const target = { projectId: "project-a", machineId: GPU };

  it("accepts the Project and machine that opened the confirmation", () => {
    expect(samePluginTarget(target, { projectId: "project-a", machineId: GPU })).toBe(true);
  });

  it("rejects a picker change while a confirmation or remote read is pending", () => {
    expect(samePluginTarget(target, { projectId: "project-a", machineId: SELF })).toBe(false);
  });

  it("rejects another Project even when it uses the same machine", () => {
    expect(samePluginTarget(target, { projectId: "project-b", machineId: GPU })).toBe(false);
  });

  it("rejects a target before the Project or this server id is ready", () => {
    expect(samePluginTarget(target, { projectId: null, machineId: GPU })).toBe(false);
    expect(samePluginTarget(target, { projectId: "project-a", machineId: undefined })).toBe(false);
  });
});
