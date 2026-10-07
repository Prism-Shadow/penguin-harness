import { describe, expect, it } from "vitest";
import type {
  WafRepoStatus,
  WafWorkspaceSettings,
  WafWorkspaceStatus,
} from "@prismshadow/penguin-server/api";
import {
  shouldPollWafWorkspace,
  wafFormFromSettings,
  wafWorkspaceUpdate,
  wafWorkspaceView,
} from "../src/features/settings/waf-workspace";

function repo(id: WafRepoStatus["id"], over: Partial<WafRepoStatus> = {}): WafRepoStatus {
  return {
    id,
    path: `/home/waf/${id}`,
    present: true,
    remote: `git@github.com:org/${id}.git`,
    remoteMatches: true,
    branch: "main",
    branchMatches: true,
    dirty: false,
    installed: id === "framework" || id === "navbar" ? true : null,
    ...over,
  };
}

function status(over: Partial<WafWorkspaceStatus> = {}): WafWorkspaceStatus {
  return {
    managed: true,
    root: "/home/waf",
    ready: true,
    repos: [repo("activityData"), repo("media"), repo("navbar"), repo("framework")],
    preparing: false,
    lastError: null,
    log: [],
    ...over,
  };
}

/** Settings as a fresh server holds them. */
function defaultSettingsForTest(): WafWorkspaceSettings {
  const github = (name: string) => `git@github.com:waterfordresearchinstitute/${name}.git`;
  return {
    externalRoot: "",
    repos: {
      framework: { remote: github("waf-framework"), branch: "v2" },
      navbar: { remote: github("waf-module-navbar"), branch: "main" },
      media: { remote: github("waf-media"), branch: "main" },
      activityData: { remote: github("waf-activity-data"), branch: "main" },
    },
    moduleRemote: github("{module}"),
  };
}

describe("the WAF workspace page", () => {
  it("lists the repositories in a fixed order and says each one's state in words", () => {
    const view = wafWorkspaceView(
      status({
        ready: false,
        repos: [
          repo("framework", { installed: false }),
          repo("navbar", { present: false, remote: null, branch: null }),
          repo("media", { remoteMatches: false, remote: "git@github.com:someone/else.git" }),
          repo("activityData", { dirty: true }),
        ],
      }),
    );
    expect(view.tone).toBe("attention");
    expect(view.repos.map((line) => [line.id, line.tone, line.line])).toEqual([
      ["framework", "attention", "Cloned, dependencies not installed"],
      ["navbar", "attention", "Not cloned"],
      ["media", "danger", "A clone of git@github.com:someone/else.git, not the remote below"],
      ["activityData", "success", "Cloned, main, with local changes"],
    ]);
  });

  it("shows a failed preparation with its log, and polls only while one runs", () => {
    const failed = wafWorkspaceView(
      status({ ready: false, lastError: "Cloning failed", log: ["Cloning…", "Failed"] }),
    );
    expect(failed.failure).toBe("Cloning failed");
    expect(failed.log).toBe("Cloning…\nFailed");
    const running = status({ preparing: true, lastError: "old" });
    expect(wafWorkspaceView(running)).toMatchObject({
      tone: "busy",
      failure: null,
      canPrepare: false,
    });
    expect(shouldPollWafWorkspace(running)).toBe(true);
    expect(shouldPollWafWorkspace(status())).toBe(false);
  });

  it("offers no Prepare for an existing checkout, which Penguin only reads", () => {
    const view = wafWorkspaceView(status({ managed: false, root: "C:/waterford" }));
    expect(view.line).toBe("Using the existing checkout at C:/waterford");
    expect(view.canPrepare).toBe(false);
  });

  it("sends only what changed, with a repository's fields grouped under it", () => {
    const saved = defaultSettingsForTest();
    const form = wafFormFromSettings(saved);
    expect(wafWorkspaceUpdate(form, saved)).toBeNull();
    form["repos.framework.branch"] = " v3 ";
    form.externalRoot = "C:/waterford";
    expect(wafWorkspaceUpdate(form, saved)).toEqual({
      externalRoot: "C:/waterford",
      repos: { framework: { branch: "v3" } },
    });
  });
});
