/**
 * The deploy settings: validation (addresses, remotes, versions, emails, waits), the token
 * rules (empty keeps, null clears), the masked view, what a QA deploy still needs, and the
 * secrets file, which is 0600 and holds the only copy of a token.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_ACTIVITY_DATA_REMOTE,
  DEPLOY_SECRETS_FILE,
  defaultDeploySettings,
  mergeSecrets,
  missingSettings,
  normalizeDeploySettings,
  readDeploySecrets,
  readDeploySettings,
  viewOf,
} from "../src/activities/deploy-settings.js";
import { HttpError } from "../src/http/errors.js";
import type { DeploySettingsResponse } from "../src/activities/deploy-types.js";
import { apiClient, createTestApp, loginAdmin } from "./helpers.js";

/** The field a rejected update names. */
function rejectedField(input: unknown): string | undefined {
  try {
    normalizeDeploySettings(input, defaultDeploySettings());
  } catch (error) {
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).code).toBe("invalid_deploy_setting");
    return (error as HttpError).detail?.field;
  }
  return undefined;
}

describe("deploy settings", () => {
  it("starts from Loom's job names, tiers and activity-data remote", () => {
    const settings = defaultDeploySettings();
    expect(settings.jobs).toEqual({
      moduleBuild: "Build WAF Modules",
      activityDeploy: "WAF Activity Deploy",
    });
    expect(settings.qa).toMatchObject({ tier: "qa", environment: "loom" });
    expect(settings.prod).toMatchObject({ tier: "prod", environment: "DEFAULT" });
    expect(settings.repos.activityDataRemote).toBe(DEFAULT_ACTIVITY_DATA_REMOTE);
    expect(settings.timeouts).toEqual({ buildMinutes: 30, deployMinutes: 30 });
  });

  it("keeps https addresses, and plain http only on this machine", () => {
    const { settings } = normalizeDeploySettings(
      {
        qa: {
          jenkinsUrl: " https://jenkins.example.org/ ",
          activityBaseUrl: "http://localhost:8080/",
        },
        prod: { jenkinsUrl: "http://127.0.0.1:9090" },
      },
      defaultDeploySettings(),
    );
    expect(settings.qa.jenkinsUrl).toBe("https://jenkins.example.org");
    expect(settings.qa.activityBaseUrl).toBe("http://localhost:8080");
    expect(settings.prod.jenkinsUrl).toBe("http://127.0.0.1:9090");
    expect(rejectedField({ qa: { jenkinsUrl: "http://jenkins.example.org" } })).toBe(
      "qa.jenkinsUrl",
    );
    expect(rejectedField({ qa: { jenkinsUrl: "ftp://jenkins.example.org" } })).toBe(
      "qa.jenkinsUrl",
    );
    expect(rejectedField({ prod: { jenkinsUrl: "https://me:secret@jenkins.example.org" } })).toBe(
      "prod.jenkinsUrl",
    );
    expect(rejectedField({ qa: { activityBaseUrl: "https://qa.example.org/?x=1" } })).toBe(
      "qa.activityBaseUrl",
    );
    expect(rejectedField({ qa: { jenkinsUrl: "jenkins" } })).toBe("qa.jenkinsUrl");
  });

  it("accepts SSH and https git remotes, and refuses one carrying a password", () => {
    const { settings } = normalizeDeploySettings(
      {
        repos: {
          activityDataRemote: "ssh://git@github.com/org/data.git",
          mediaRemote: "git@github.com:org/media.git",
        },
      },
      defaultDeploySettings(),
    );
    expect(settings.repos).toEqual({
      activityDataRemote: "ssh://git@github.com/org/data.git",
      mediaRemote: "git@github.com:org/media.git",
    });
    expect(
      rejectedField({ repos: { mediaRemote: "https://me:pw@github.com/org/media.git" } }),
    ).toBe("repos.mediaRemote");
    expect(rejectedField({ repos: { mediaRemote: "file:///tmp/media" } })).toBe(
      "repos.mediaRemote",
    );
  });

  it("checks versions, emails, names and waits", () => {
    const { settings } = normalizeDeploySettings(
      {
        qa: { frameworkVersion: "4.2.1" },
        prod: { frameworkVersion: "v4.2.0-rc.1" },
        git: { userName: " Deploy Bot ", userEmail: "deploy@example.org" },
        timeouts: { buildMinutes: 45 },
      },
      defaultDeploySettings(),
    );
    expect(settings.qa.frameworkVersion).toBe("4.2.1");
    expect(settings.prod.frameworkVersion).toBe("v4.2.0-rc.1");
    expect(settings.git).toEqual({ userName: "Deploy Bot", userEmail: "deploy@example.org" });
    expect(settings.timeouts).toEqual({ buildMinutes: 45, deployMinutes: 30 });
    expect(rejectedField({ qa: { frameworkVersion: "latest" } })).toBe("qa.frameworkVersion");
    expect(rejectedField({ git: { userEmail: "not an email" } })).toBe("git.userEmail");
    expect(rejectedField({ jobs: { moduleBuild: "x".repeat(201) } })).toBe("jobs.moduleBuild");
    expect(rejectedField({ timeouts: { deployMinutes: 0 } })).toBe("timeouts.deployMinutes");
    expect(rejectedField({ timeouts: { deployMinutes: 2.5 } })).toBe("timeouts.deployMinutes");
    expect(rejectedField({ qa: "nope" })).toBe("qa");
  });

  it("puts an emptied job name back to its default", () => {
    const { settings } = normalizeDeploySettings(
      { jobs: { moduleBuild: "  " } },
      { ...defaultDeploySettings(), jobs: { moduleBuild: "Other", activityDeploy: "Other" } },
    );
    expect(settings.jobs).toEqual({ moduleBuild: "Build WAF Modules", activityDeploy: "Other" });
  });

  it("keeps a field the update leaves out, and changes nothing when one field is refused", () => {
    const current = normalizeDeploySettings(
      { qa: { username: "robot" } },
      defaultDeploySettings(),
    ).settings;
    const { settings } = normalizeDeploySettings({ qa: { tier: "qa2" } }, current);
    expect(settings.qa).toMatchObject({ username: "robot", tier: "qa2" });
    // The refused update throws before returning anything, so nothing can be stored.
    expect(() =>
      normalizeDeploySettings({ qa: { tier: "qa3", jenkinsUrl: "nope" } }, current),
    ).toThrow(HttpError);
  });

  it("keeps a token left empty, clears one set to null, and replaces one given", () => {
    const stored = { qaToken: "old-qa", prodToken: "old-prod" };
    const keep = normalizeDeploySettings({ qa: { token: "" }, prod: {} }, defaultDeploySettings());
    expect(keep.tokens).toEqual({});
    expect(mergeSecrets(stored, keep.tokens)).toEqual(stored);
    const change = normalizeDeploySettings(
      { qa: { token: " new-qa " }, prod: { token: null } },
      defaultDeploySettings(),
    );
    expect(change.tokens).toEqual({ qa: "new-qa", prod: null });
    expect(mergeSecrets(stored, change.tokens)).toEqual({ qaToken: "new-qa" });
    expect(rejectedField({ qa: { token: "has space" } })).toBe("qa.token");
  });

  it("shows only whether a token is set", () => {
    const view = viewOf(defaultDeploySettings(), { qaToken: "secret-qa" });
    expect(view.qa.token).toEqual({ set: true });
    expect(view.prod.token).toEqual({ set: false });
    expect(JSON.stringify(view)).not.toContain("secret-qa");
  });

  it("reads a stored row tolerantly, taking defaults for what is missing or wrong", () => {
    const settings = readDeploySettings(
      JSON.stringify({ qa: { username: "robot", tier: 7 }, timeouts: { buildMinutes: "x" } }),
    );
    expect(settings.qa).toMatchObject({ username: "robot", tier: "qa" });
    expect(settings.timeouts.buildMinutes).toBe(30);
    expect(readDeploySettings("{not json")).toEqual(defaultDeploySettings());
    expect(readDeploySettings(null)).toEqual(defaultDeploySettings());
    expect(readDeploySecrets("{bad")).toEqual({});
    expect(readDeploySecrets(JSON.stringify({ qaToken: "a", prodToken: 3 }))).toEqual({
      qaToken: "a",
    });
  });

  it("names every setting a QA deploy still needs", () => {
    expect(missingSettings(defaultDeploySettings(), {})).toEqual([
      "qa.jenkinsUrl",
      "qa.username",
      "qa.token",
      "qa.frameworkVersion",
      "qa.activityBaseUrl",
      "repos.mediaRemote",
      "git.userName",
      "git.userEmail",
    ]);
  });
});

describe("deploy secrets file", () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  it("writes tokens to a 0600 file and never into the settings row or a response", async () => {
    const t = await createTestApp();
    cleanups.push(t.cleanup);
    const admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    const saved = await admin.put("/api/admin/activity-deploy/settings", {
      qa: { username: "robot", token: "qa-token-123" },
    });
    expect(saved.status).toBe(200);
    const text = await saved.text();
    expect(text).not.toContain("qa-token-123");
    expect((JSON.parse(text) as DeploySettingsResponse).settings.qa.token).toEqual({ set: true });
    const file = path.join(t.root, DEPLOY_SECRETS_FILE);
    expect(JSON.parse(fs.readFileSync(file, "utf8"))).toEqual({ qaToken: "qa-token-123" });
    if (process.platform !== "win32") expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    const row = t.deps.tree
      .api<{ get(key: string): string | null }>("SettingsModule", "Settings")
      .get("activityDeploy");
    expect(row).not.toContain("qa-token-123");
  });
});
