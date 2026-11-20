/**
 * Why the embedded server stopped while starting (src/start-failure.ts): the start dialog shows the
 * server's own reason — the `Error:` lines it printed last — and nothing when it printed none.
 */
import { describe, expect, it } from "vitest";
import { startFailureReason } from "../src/start-failure.js";

describe("the reason a start failed", () => {
  it("is the server's own error line, not the lines around it", () => {
    const stderr = [
      "penguin-server started: http://localhost:7365",
      "Data root: /home/me/.penguin/data",
      'LayoutMigrationError: The data root holds a Project named "projects", which is the name the new layout needs for its Projects folder. Nothing was moved.',
      "",
    ].join("\n");
    expect(startFailureReason(stderr)).toBe(
      'LayoutMigrationError: The data root holds a Project named "projects", which is the name the new layout needs for its Projects folder. Nothing was moved.',
    );
  });

  it("is nothing when the server printed no error", () => {
    expect(startFailureReason("penguin-server started: http://localhost:7365\n")).toBeNull();
  });
});
