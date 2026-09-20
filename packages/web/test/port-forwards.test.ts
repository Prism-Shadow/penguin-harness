/**
 * How a port forward reads: the tone is the worst layer's, the lines name each layer, and a
 * machine's page groups rows by the Workspace that made them.
 */
import { describe, expect, it } from "vitest";
import type { PortForwardInfo } from "@prismshadow/penguin-server/api";
import {
  dialLine,
  forwardTone,
  groupByWorkspace,
  listenerLine,
  parsePort,
} from "../src/features/ports/port-forward-facts";
import { PANEL_KINDS } from "../src/features/dock/dock-state";

const forward = (over: Partial<PortForwardInfo> = {}): PortForwardInfo => ({
  id: "f1",
  machineId: "QS7J4YVgSovi-Z2c",
  workspace: "/home/dev/site",
  remotePort: 3000,
  localPort: 3000,
  createdAt: "2026-09-19T08:00:00.000Z",
  listener: { listening: true },
  dial: null,
  open: 0,
  bytesUp: 0,
  bytesDown: 0,
  ...over,
});

describe("a forward's tone", () => {
  it("is in contact while nothing says otherwise — a forward nobody has used yet is not a problem", () => {
    expect(forwardTone(forward())).toBe("link");
    expect(forwardTone(forward({ dial: { answeredAt: "2026-09-19T08:01:00.000Z" } }))).toBe("link");
  });

  it("asks for attention when the last dial got nowhere", () => {
    expect(
      forwardTone(
        forward({
          dial: { failedAt: "2026-09-19T08:01:00.000Z", detail: "machine not connected" },
        }),
      ),
    ).toBe("attention");
  });

  it("is the listener's failure first: with no listener no dial can even be tried", () => {
    expect(
      forwardTone(
        forward({
          listener: { error: "EADDRINUSE" },
          dial: { answeredAt: "2026-09-19T08:01:00.000Z" },
        }),
      ),
    ).toBe("danger");
  });
});

describe("a forward's lines", () => {
  it("name each layer with what it knows", () => {
    expect(listenerLine(forward({ listener: { error: "EADDRINUSE" } }))).toContain("EADDRINUSE");
    expect(
      dialLine(
        forward({
          dial: { failedAt: "2026-09-19T08:01:00.000Z", detail: "machine not connected" },
        }),
        "en",
      ),
    ).toContain("machine not connected");
    expect(dialLine(forward(), "en")).not.toBe("");
  });
});

describe("parsePort", () => {
  it("takes whole numbers in range, and nothing else", () => {
    expect(parsePort("3000")).toBe(3000);
    expect(parsePort(" 65535 ")).toBe(65535);
    expect(parsePort("0")).toBeNull();
    expect(parsePort("65536")).toBeNull();
    expect(parsePort("30.5")).toBeNull();
    expect(parsePort("3e3")).toBeNull();
    expect(parsePort("")).toBeNull();
    expect(parsePort("80", 1024)).toBeNull();
  });
});

describe("groupByWorkspace", () => {
  it("groups rows under their Workspace, Workspaces in path order, rows as they came", () => {
    const groups = groupByWorkspace([
      forward({ id: "b1", workspace: "/srv/b" }),
      forward({ id: "a1", workspace: "/srv/a" }),
      forward({ id: "b2", workspace: "/srv/b" }),
    ]);
    expect(groups.map(([workspace, rows]) => [workspace, rows.map((row) => row.id)])).toEqual([
      ["/srv/a", ["a1"]],
      ["/srv/b", ["b1", "b2"]],
    ]);
  });
});

describe("the dock", () => {
  it("has a Ports panel", () => {
    expect(PANEL_KINDS).toContain("ports");
  });
});
