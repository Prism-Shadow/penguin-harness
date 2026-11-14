/**
 * The Node floor the server and the CLI check where each process starts (src/node-floor.ts).
 *
 * - Given the floor itself or anything newer — a later minor, a later major, Electron's
 *   `process.versions.node` without the "v", a pre-release build — the runtime may run.
 * - Given an older release (the last Node 23, Node 22, Node 20), it may not, and the refusal
 *   names the version it saw.
 * - Given a version string it cannot read, it lets the runtime run rather than guess.
 */
import { describe, expect, it } from "vitest";
import { meetsNodeFloor, nodeFloorRefusal } from "../src/node-floor.js";

describe("the Node floor", () => {
  it("lets the floor and every newer runtime run", () => {
    for (const version of [
      "v24.0.0",
      "v24.12.0",
      "v24.18.0",
      "v25.1.0",
      "v30.0.0",
      "24.22.0", // Electron 43's process.versions.node, the desktop app's server
      "v24.0.0-nightly20250101abcdef",
    ]) {
      expect(meetsNodeFloor(version), version).toBe(true);
      expect(nodeFloorRefusal(version), version).toBeNull();
    }
  });

  it("turns older runtimes away, naming the version it saw", () => {
    for (const version of ["v23.11.1", "v22.23.4", "v20.19.2", "v18.20.8"]) {
      expect(meetsNodeFloor(version), version).toBe(false);
      expect(nodeFloorRefusal(version), version).toContain(version);
    }
  });

  it("compares every part of the version against a floor that has them", () => {
    expect(meetsNodeFloor("v24.11.9", "24.12.0")).toBe(false);
    expect(meetsNodeFloor("v24.12.0", "24.12.0")).toBe(true);
    expect(meetsNodeFloor("v24.12.1", "24.12.0")).toBe(true);
    expect(meetsNodeFloor("v23.99.99", "24.0.0")).toBe(false);
  });

  it("lets a runtime whose version it cannot read run", () => {
    for (const version of ["", "unknown", "v24"]) {
      expect(meetsNodeFloor(version), version).toBe(true);
    }
  });
});
