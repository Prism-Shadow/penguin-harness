/**
 * This backend's page in Settings (src/status.ts), from where the sandbox says it stands.
 *
 * - In use: the check names the rung that confines, and what that rung leaves open is the page's
 *   notices.
 * - Refused at load: the check needs action, with DSH's own words folded under it, and no notices.
 */
import { describe, expect, it } from "vitest";
import { dshNotices, dshReport } from "../src/status.js";

describe("the DSH page", () => {
  it("names the rung that confines, and lists what it leaves open", () => {
    const view = {
      backends: () => [
        {
          name: "dsh-local",
          mechanism: "Landlock",
          limits: [{ text: "Landlock: /tmp is shared", textZh: "Landlock：/tmp 共享" }],
        },
      ],
      failures: () => [],
    };
    expect(dshReport(view).checks?.[0]).toMatchObject({
      state: "ok",
      text: "Confines file writes by Landlock",
    });
    expect(dshNotices(view)).toEqual([
      { tone: "muted", text: "Landlock: /tmp is shared", textZh: "Landlock：/tmp 共享" },
    ]);
  });

  it("asks for action when the load was refused, with DSH's words folded under it", () => {
    const view = {
      backends: () => [],
      failures: () => [{ name: "dsh-local", reason: "no rung works here" }],
    };
    expect(dshReport(view).checks?.[0]).toMatchObject({
      state: "action",
      details: "no rung works here",
    });
    expect(dshNotices(view)).toEqual([]);
  });
});
