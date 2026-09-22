/**
 * How a port forward reads: the tone is the worst layer's, the lines name each layer, and a
 * machine's page groups rows by the Workspace that made them.
 */
import { describe, expect, it } from "vitest";
import type { PortForwardInfo } from "@prismshadow/penguin-server/api";
import {
  forwardTone,
  groupByWorkspace,
  parsePort,
  statusLine,
} from "../src/features/ports/port-forward-facts";
import { PANEL_KINDS } from "../src/features/dock/dock-state";

const forward = (over: Partial<PortForwardInfo> = {}): PortForwardInfo => ({
  id: "f1",
  machineId: "QS7J4YVgSovi-Z2c",
  workspace: "/home/dev/site",
  direction: "in",
  remotePort: 3000,
  localPort: 3000,
  createdAt: "2026-09-19T08:00:00.000Z",
  via: "ssh",
  status: { kind: "active" },
  ...over,
});

describe("a forward's tone and line", () => {
  it("is carried, waiting, down, or refused — in that order of colour", () => {
    expect(forwardTone(forward())).toBe("link");
    expect(forwardTone(forward({ status: { kind: "pending" } }))).toBe("muted");
    expect(forwardTone(forward({ status: { kind: "not-connected" } }))).toBe("attention");
    expect(forwardTone(forward({ status: { kind: "failed", detail: "bind: in use" } }))).toBe(
      "danger",
    );
  });

  it("says who carries it, and repeats ssh's own words when it refused", () => {
    expect(statusLine(forward())).not.toBe(statusLine(forward({ via: "listener" })));
    expect(statusLine(forward({ status: { kind: "failed", detail: "bind: in use" } }))).toContain(
      "bind: in use",
    );
    expect(statusLine(forward({ status: { kind: "not-connected" } }))).not.toBe("");
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
