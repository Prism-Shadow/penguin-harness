/**
 * The shell's organization status marks (features/company/shell-org-status.ts): which state
 * an organization headlines and its tone, and what a session-list group renders so a failed
 * fetch never leaves a skeleton behind.
 */
import { describe, expect, it } from "vitest";
import {
  ORG_STATUS_TONE,
  groupRender,
  orgStatusKind,
} from "../src/features/company/shell-org-status";

describe("orgStatusKind", () => {
  it("ranks invalid configuration above paused, and paused above active", () => {
    expect(orgStatusKind({ status: "active" })).toBe("active");
    expect(orgStatusKind({ status: "paused" })).toBe("paused");
    expect(orgStatusKind({ status: "paused", invalid: "bad chart" })).toBe("invalid");
    expect(orgStatusKind({ status: "active", invalid: "bad chart" })).toBe("invalid");
  });

  it("maps the three states to danger, attention and success", () => {
    expect(ORG_STATUS_TONE).toEqual({ invalid: "danger", paused: "attention", active: "success" });
  });
});

describe("groupRender", () => {
  it("shows the skeleton only until a fetch has completed", () => {
    expect(groupRender({ loaded: false, settled: false, count: 0 })).toBe("loading");
  });

  it("shows the error line once a fetch completed without this group", () => {
    expect(groupRender({ loaded: false, settled: true, count: 0 })).toBe("error");
  });

  it("shows the list or the empty line once the group is held", () => {
    expect(groupRender({ loaded: true, settled: true, count: 0 })).toBe("empty");
    expect(groupRender({ loaded: true, settled: false, count: 3 })).toBe("list");
  });
});
