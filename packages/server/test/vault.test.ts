/**
 * Integration tests for the Vault environment variable routes (Agent-level
 * agent_state/.vault.toml): GET masks values (plaintext
 * is never sent), PUT is owner-only, whole-table replace semantics (omitting
 * value keeps the original, an absent key is deleted, a new key must supply a
 * value), 400 on key/shape validation, 404 for a nonexistent Agent, and vaults
 * of different Agents are independent of each other.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ProjectCreateResponse, VaultResponse } from "../src/api/types.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

describe("vault api", () => {
  let t: TestApp;
  let owner: ReturnType<typeof apiClient>;
  let member: ReturnType<typeof apiClient>;
  let outsider: ReturnType<typeof apiClient>;
  let projectId: string;
  let vaultPath: string;

  beforeEach(async () => {
    t = await createTestApp();
    const a = await provisionUser(t.app, "owner_a");
    const b = await provisionUser(t.app, "member_b");
    const c = await provisionUser(t.app, "outsider_c");
    owner = apiClient(t.app, a.cookie);
    member = apiClient(t.app, b.cookie);
    outsider = apiClient(t.app, c.cookie);
    const created = (await (
      await owner.post("/api/projects", { projectId: "owner_a-vault", name: "vault project" })
    ).json()) as ProjectCreateResponse;
    projectId = created.project.projectId;
    vaultPath = `/api/projects/${projectId}/agents/default_agent/vault`;
    const add = await owner.post(`/api/projects/${projectId}/members`, { userId: "member_b" });
    expect(add.status).toBe(201);
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("GET masks values and never sends plaintext; members can read, outsiders 404; an empty vault returns an empty table", async () => {
    // Not configured yet: an empty table.
    const empty = (await (await owner.get(vaultPath)).json()) as VaultResponse;
    expect(empty.entries).toEqual([]);

    const put = await owner.put(vaultPath, {
      entries: [
        { key: "OPENAI_API_KEY", value: "sk-vault-secret-123456" },
        { key: "SHORT", value: "sk-11-chars" },
      ],
    });
    expect(put.status).toBe(200);
    // The PUT response likewise contains only masked values.
    expect(JSON.stringify(await put.json())).not.toContain("sk-vault-secret-123456");

    const res = await member.get(vaultPath);
    expect(res.status).toBe(200);
    const body = (await res.json()) as VaultResponse;
    expect(body.entries).toEqual([
      { key: "OPENAI_API_KEY", valueMasked: "sk-v…3456" },
      { key: "SHORT", valueMasked: "***" }, // ≤12 chars are masked entirely (first4…last4 would expose over half)
    ]);
    expect(JSON.stringify(body)).not.toContain("sk-vault-secret-123456");
    expect(JSON.stringify(body)).not.toContain("sk-11-chars");

    expect((await outsider.get(vaultPath)).status).toBe(404);
  });

  it("PUT is owner-only: member 403, outsider 404", async () => {
    expect((await member.put(vaultPath, { entries: [{ key: "K", value: "v" }] })).status).toBe(403);
    expect((await outsider.put(vaultPath, { entries: [{ key: "K", value: "v" }] })).status).toBe(
      404,
    );
  });

  it("whole-table replace: omitting value keeps the original, absent keys are deleted, a new key without value 400", async () => {
    await owner.put(vaultPath, {
      entries: [
        { key: "KEEP_ME", value: "keep-secret-000111" },
        { key: "DROP_ME", value: "drop-secret" },
      ],
    });

    // KEEP_ME only sends back the key name (keeping the original value); DROP_ME is absent (deleted).
    const second = (await (
      await owner.put(vaultPath, { entries: [{ key: "KEEP_ME" }] })
    ).json()) as VaultResponse;
    expect(second.entries).toEqual([{ key: "KEEP_ME", valueMasked: "keep…0111" }]);

    // A new key without value → 400 (there's no original value to keep).
    const bad = await owner.put(vaultPath, {
      entries: [{ key: "KEEP_ME" }, { key: "BRAND_NEW" }],
    });
    expect(bad.status).toBe(400);

    // Clear the whole table.
    const cleared = (await (await owner.put(vaultPath, { entries: [] })).json()) as VaultResponse;
    expect(cleared.entries).toEqual([]);
  });

  it("vault updates leave models/credential and other config untouched", async () => {
    await owner.put(`/api/projects/${projectId}/models`, {
      defaultModel: { provider: "custom", modelId: "m-1" },
      models: [{ provider: "custom", modelId: "m-1", apiKey: "sk-model-key-999888" }],
    });
    await owner.put(vaultPath, { entries: [{ key: "K1", value: "v1-secret" }] });

    const models = await owner.get(`/api/projects/${projectId}/models`);
    const modelsBody = (await models.json()) as { models: { credential?: unknown }[] };
    expect(modelsBody.models).toHaveLength(1);
    expect(modelsBody.models[0]!.credential).toBeTruthy();
  });

  it("Agent-level isolation: different Agents' vaults are independent; a nonexistent Agent 404", async () => {
    await owner.put(vaultPath, { entries: [{ key: "ONLY_DEFAULT", value: "v-default-1" }] });

    // Another Agent in the same Project: empty table, and writes don't affect each other.
    expect(
      (await owner.post(`/api/projects/${projectId}/agents`, { agentId: "other_agent" })).status,
    ).toBe(201);
    const otherPath = `/api/projects/${projectId}/agents/other_agent/vault`;
    const empty = (await (await owner.get(otherPath)).json()) as VaultResponse;
    expect(empty.entries).toEqual([]);
    await owner.put(otherPath, { entries: [{ key: "ONLY_OTHER", value: "v-other-1" }] });
    const def = (await (await owner.get(vaultPath)).json()) as VaultResponse;
    expect(def.entries.map((e) => e.key)).toEqual(["ONLY_DEFAULT"]);

    // Agent doesn't exist (including traversal-style ids blocked by requireValidId) → 404.
    expect((await owner.get(`/api/projects/${projectId}/agents/no-such-agent/vault`)).status).toBe(
      404,
    );
    expect(
      (
        await owner.put(`/api/projects/${projectId}/agents/no-such-agent/vault`, {
          entries: [{ key: "K", value: "v" }],
        })
      ).status,
    ).toBe(404);
  });

  it("key name and request body shape validation 400", async () => {
    const cases: unknown[] = [
      { entries: [{ key: "1BAD", value: "v" }] }, // starts with a digit
      { entries: [{ key: "BAD-DASH", value: "v" }] }, // hyphen
      { entries: [{ key: "BAD KEY", value: "v" }] }, // space
      { entries: [{ key: "OK_KEY", value: "" }] }, // empty value
      {
        entries: [
          { key: "DUP", value: "a" },
          { key: "DUP", value: "b" },
        ],
      }, // duplicate key
      { entries: [{ key: "BIG", value: "x".repeat(8193) }] }, // value too long (>8192, guards against exec E2BIG)
      { entries: "nope" }, // entries is not an array
      { entries: [42] }, // entry is not an object
    ];
    for (const body of cases) {
      expect((await owner.put(vaultPath, body)).status).toBe(400);
    }
  });
});
