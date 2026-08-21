/**
 * GET|PUT /api/projects/:p/command-policy — the Project sandbox command policy (the
 * `[command_policy]` block of .project_config.toml).
 *
 * Pins the contract's load-bearing corners: who may read (any member) and write (owner
 * only, a non-member unable to tell the Project exists); that a new project is seeded with
 * the factory rules while a pre-seeding project (no stored block) still serves them as the
 * effective set; that the rules are plain editable data (edit / disable / delete / add all
 * round-trip) and a PUT materializes the full list; that an uncompilable pattern is
 * rejected up front (a rule that cannot fire must not save); and that a policy write is a
 * read-modify-write — the models table must survive.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import type {
  CommandPolicyDto,
  ErrorBody,
  ModelsResponse,
  ProjectCreateResponse,
} from "../src/api/types.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

describe("project command policy", () => {
  let t: TestApp;
  let owner: ReturnType<typeof apiClient>;
  let member: ReturnType<typeof apiClient>;
  let outsider: ReturnType<typeof apiClient>;
  let projectId: string;
  let url: string;

  beforeEach(async () => {
    t = await createTestApp();
    const a = await provisionUser(t.app, "owner_a");
    const b = await provisionUser(t.app, "member_b");
    const c = await provisionUser(t.app, "outsider_c");
    owner = apiClient(t.app, a.cookie);
    member = apiClient(t.app, b.cookie);
    outsider = apiClient(t.app, c.cookie);
    const created = (await (
      await owner.post("/api/projects", { projectId: "owner_a-shared", name: "Shared" })
    ).json()) as ProjectCreateResponse;
    projectId = created.project.projectId;
    url = `/api/projects/${projectId}/command-policy`;
    expect(
      (await owner.post(`/api/projects/${projectId}/members`, { userId: "member_b" })).status,
    ).toBe(201);
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("a new project is seeded with the factory rules; any member reads; a non-member gets 404", async () => {
    // Seeded at creation, model-presets style: the file itself carries the block.
    const toml = await fs.readFile(path.join(t.root, projectId, ".project_config.toml"), "utf8");
    expect(toml).toContain("[[command_policy.rules]]");

    const res = await member.get(url);
    expect(res.status).toBe(200);
    const dto = (await res.json()) as CommandPolicyDto;
    expect(dto.enabled).toBe(true);
    expect(dto.rules.map((r) => r.name)).toContain("rm-recursive-force");
    expect(dto.rules.every((r) => r.enabled)).toBe(true);
    expect(dto.defaultRules).toEqual(dto.rules);
    expect((await outsider.get(url)).status).toBe(404);
  });

  it("a pre-seeding project (no stored block) still serves the factory rules", async () => {
    // Strip the seeded block, mimicking a config written before the feature existed
    // (drop every command_policy line up to the [[models]] section).
    const file = path.join(t.root, projectId, ".project_config.toml");
    const lines = (await fs.readFile(file, "utf8")).split("\n");
    const start = lines.findIndex((l) => l.replace(/^\[+/, "").startsWith("command_policy"));
    const end = lines.findIndex((l) => l.startsWith("[[models]]"));
    expect(start).toBeGreaterThanOrEqual(0);
    await fs.writeFile(file, [...lines.slice(0, start), ...lines.slice(end)].join("\n"), "utf8");

    const dto = (await (await owner.get(url)).json()) as CommandPolicyDto;
    expect(dto.enabled).toBe(true);
    expect(dto.rules.map((r) => r.name)).toContain("rm-recursive-force");
  });

  it("rules are editable data: edit, disable, delete and add all round-trip", async () => {
    const before = (await (await owner.get(url)).json()) as CommandPolicyDto;
    const edited = before.rules
      .filter((r) => r.name !== "fork-bomb") // delete one
      .map((r) =>
        r.name === "rm-recursive-force"
          ? { ...r, enabled: false } // disable one (the rm -rf node_modules escape hatch)
          : r.name === "mkfs"
            ? { ...r, name: "no-mkfs", description: "renamed by the owner" } // edit one
            : r,
      );
    edited.push({ name: "no-curl", pattern: "\\bcurl\\b", enabled: true });

    const put = await owner.put(url, { enabled: true, rules: edited });
    expect(put.status).toBe(200);
    const stored = (await put.json()) as CommandPolicyDto;
    expect(stored.rules).toEqual(edited);
    // The factory reference is unaffected by edits.
    expect(stored.defaultRules).toEqual(before.defaultRules);

    const toml = await fs.readFile(path.join(t.root, projectId, ".project_config.toml"), "utf8");
    expect(toml).toContain('name = "no-mkfs"');
    expect(toml).not.toContain("fork-bomb");

    // Restore defaults = PUT the served factory set back.
    const restore = await owner.put(url, { enabled: true, rules: stored.defaultRules });
    expect(((await restore.json()) as CommandPolicyDto).rules).toEqual(before.defaultRules);
  });

  it("an empty rules list and a disabled policy both round-trip", async () => {
    expect((await owner.put(url, { enabled: false, rules: [] })).status).toBe(200);
    const dto = (await (await owner.get(url)).json()) as CommandPolicyDto;
    expect(dto.enabled).toBe(false);
    expect(dto.rules).toEqual([]);
    // Factory reference still served for restore.
    expect(dto.defaultRules.length).toBeGreaterThan(0);
  });

  it("member PUT is 403; outsider PUT is 404", async () => {
    expect((await member.put(url, { rules: [] })).status).toBe(403);
    expect((await outsider.put(url, { rules: [] })).status).toBe(404);
  });

  it("rejects an uncompilable pattern with the rule's name in the message", async () => {
    const res = await owner.put(url, { rules: [{ name: "broken", pattern: "(" }] });
    expect(res.status).toBe(400);
    const body = (await res.json()) as ErrorBody;
    expect(body.error.code).toBe("invalid_rule_pattern");
    expect(body.error.message).toContain("broken");
  });

  it("rejects malformed bodies (missing rules, bad entries, wrong types)", async () => {
    expect((await owner.put(url, {})).status).toBe(400); // rules is required
    for (const rules of [
      [{ pattern: "x" }],
      [{ name: "", pattern: "x" }],
      [{ name: "n" }],
      [{ name: "n", pattern: "" }],
      [{ name: "n", pattern: "x", enabled: "yes" }],
      [{ name: "n", pattern: "x", description: 42 }],
      ["not-an-object"],
      "not-an-array",
    ]) {
      const res = await owner.put(url, { rules });
      expect(res.status, JSON.stringify(rules)).toBe(400);
    }
    expect((await owner.put(url, { enabled: "yes", rules: [] })).status).toBe(400);
  });

  it("a policy write is a read-modify-write: the models table survives", async () => {
    const before = (await (
      await owner.get(`/api/projects/${projectId}/models`)
    ).json()) as ModelsResponse;
    expect(before.models.length).toBeGreaterThan(0);
    expect((await owner.put(url, { enabled: false, rules: [] })).status).toBe(200);
    const after = (await (
      await owner.get(`/api/projects/${projectId}/models`)
    ).json()) as ModelsResponse;
    expect(after.models.length).toBe(before.models.length);
  });
});
