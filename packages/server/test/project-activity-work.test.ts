import { describe, expect, it } from "vitest";
import { wire } from "@prismshadow/penguin-core/kernel";
import { ProjectActivityWorkService } from "../src/services/project-activity-work.js";

describe("project activity admission", () => {
  it("seals before deletion, drains admitted starts, and refuses missing projects", async () => {
    let exists = true;
    const gate = wire(ProjectActivityWorkService, {
      projects: { findById: () => (exists ? {} : null) },
    });
    let release!: () => void;
    let removed = false;
    const pending = gate.run(
      "p",
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    await Promise.resolve();
    const deletion = gate.destroy("p", async () => {
      removed = true;
      exists = false;
    });
    await expect(gate.run("p", async () => {})).rejects.toMatchObject({ code: "project_deleting" });
    expect(removed).toBe(false);
    expect(
      gate.destroy("p", async () => {
        throw new Error("duplicate deletion");
      }),
    ).toBe(deletion);
    release();
    await pending;
    await deletion;
    expect(removed).toBe(true);
    await expect(gate.run("p", async () => {})).rejects.toMatchObject({
      code: "project_not_found",
    });
  });
  it("failed work and a failed deletion do not leave admission stuck", async () => {
    const gate = wire(ProjectActivityWorkService, { projects: { findById: () => ({}) } });
    await expect(
      gate.run("p", async () => {
        throw new Error("write failed");
      }),
    ).rejects.toThrow("write failed");
    await expect(
      gate.destroy("p", async () => {
        throw new Error("delete failed");
      }),
    ).rejects.toThrow("delete failed");
    expect(await gate.run("p", async () => "ready")).toBe("ready");
  });
});
