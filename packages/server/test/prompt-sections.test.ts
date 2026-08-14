/**
 * Integration tests for the Vault / Skills / Schedules prompt-injection config (the
 * memory-style placeholder + toggle + editable prompt pattern): the config route reports
 * effective values plus template facts (placeholder presence, legacy-section presence),
 * toggles and prompts round-trip through PUT …/config, and each feature's
 * POST …/template-placeholder inserts — or, for a legacy hardcoded section, migrates to —
 * its placeholder, with the routers' own permission models (skills member-level,
 * vault/schedules owner-only).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LEGACY_SKILLS_SECTION, LEGACY_VAULT_SECTION } from "@prismshadow/penguin-core";
import type {
  AgentConfigResponse,
  AgentSchedulesConfigDto,
  AgentSkillsConfigDto,
  AgentVaultConfigDto,
} from "../src/api/types.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

/** A pre-toggle template shape: hardcoded # Vault / # Skills sections, no section placeholders. */
const LEGACY_TEMPLATE = `# Role\nDo things.\n\n${LEGACY_VAULT_SECTION}\n\n${LEGACY_SKILLS_SECTION}\n\n{{MEMORY}}\n\n# Environment\n- CWD: {{CWD}}`;

describe("prompt-injection config (vault / skills / schedules)", () => {
  let t: TestApp;
  let owner: ReturnType<typeof apiClient>;
  let member: ReturnType<typeof apiClient>;
  let outsider: ReturnType<typeof apiClient>;
  let projectId: string;
  let configPath: string;
  let agentBase: string;

  beforeEach(async () => {
    t = await createTestApp();
    const a = await provisionUser(t.app, "owner_a");
    const b = await provisionUser(t.app, "member_b");
    const c = await provisionUser(t.app, "outsider_c");
    owner = apiClient(t.app, a.cookie);
    member = apiClient(t.app, b.cookie);
    outsider = apiClient(t.app, c.cookie);
    const created = (await (
      await owner.post("/api/projects", { projectId: "owner_a-sections", name: "sections" })
    ).json()) as { project: { projectId: string } };
    projectId = created.project.projectId;
    await owner.post(`/api/projects/${projectId}/members`, { userId: "member_b" });
    agentBase = `/api/projects/${projectId}/agents/default_agent`;
    configPath = `${agentBase}/config`;
  });

  afterEach(async () => {
    await t.cleanup();
  });

  const getConfig = async (): Promise<AgentConfigResponse> =>
    (await (await owner.get(configPath)).json()) as AgentConfigResponse;

  it("reports the three sections on a fresh agent: enabled, default prompts, placeholders present, no legacy section", async () => {
    const { config } = await getConfig();
    for (const dto of [config.vault, config.skills, config.schedules]) {
      expect(dto.enabled).toBe(true);
      expect(dto.templateHasPlaceholder).toBe(true);
    }
    // A fresh default agent stores the built-in prompts in its own yaml, inner tokens included.
    expect(config.vault.prompt).toContain("{{VAULT_KEYS}}");
    expect(config.skills.prompt).toContain("{{SKILL_METADATA}}");
    expect(config.schedules.prompt).toContain("{{SCHEDULE_LIST}}");
    expect(config.vault.legacySectionPresent).toBe(false);
    expect(config.skills.legacySectionPresent).toBe(false);
  });

  it("toggles each section through the config route", async () => {
    for (const feature of ["vault", "skills", "schedules"] as const) {
      const off = await owner.put(configPath, { config: { [feature]: { enabled: false } } });
      expect(off.status).toBe(200);
      expect(((await off.json()) as AgentConfigResponse).config[feature].enabled).toBe(false);
      const on = await owner.put(configPath, { config: { [feature]: { enabled: true } } });
      expect(((await on.json()) as AgentConfigResponse).config[feature].enabled).toBe(true);
    }
  });

  it("round-trips a custom prompt, leaving the other sections untouched", async () => {
    const put = await owner.put(configPath, {
      config: { vault: { prompt: "# Vault\ncustom {{VAULT_KEYS}}" } },
    });
    expect(put.status).toBe(200);
    const after = (await put.json()) as AgentConfigResponse;
    expect(after.config.vault.prompt).toBe("# Vault\ncustom {{VAULT_KEYS}}");
    expect(after.config.vault.enabled).toBe(true);
    // The untouched sections keep their defaults.
    expect(after.config.skills.prompt).toContain("{{SKILL_METADATA}}");
    expect(after.config.schedules.prompt).toContain("{{SCHEDULE_LIST}}");
  });

  it("reports a legacy template and migrates its hardcoded sections placeholder by placeholder", async () => {
    expect(
      (await owner.put(configPath, { config: { systemPrompt: LEGACY_TEMPLATE } })).status,
    ).toBe(200);
    let { config } = await getConfig();
    expect(config.vault.templateHasPlaceholder).toBe(false);
    expect(config.vault.legacySectionPresent).toBe(true);
    expect(config.skills.templateHasPlaceholder).toBe(false);
    expect(config.skills.legacySectionPresent).toBe(true);
    expect(config.schedules.templateHasPlaceholder).toBe(false);

    // Migrate skills: the legacy section is replaced verbatim, in place — the {{SKILLS}}
    // placeholder now sits exactly where the hardcoded text was.
    const migrated = await member.post(`${agentBase}/skills/template-placeholder`, {});
    expect(migrated.status).toBe(200);
    const skillsDto = (await migrated.json()) as AgentSkillsConfigDto;
    expect(skillsDto.templateHasPlaceholder).toBe(true);
    expect(skillsDto.legacySectionPresent).toBe(false);
    ({ config } = await getConfig());
    expect(config.systemPrompt).toContain("{{SKILLS}}");
    expect(config.systemPrompt).not.toContain(LEGACY_SKILLS_SECTION);
    expect(config.systemPrompt.indexOf("{{SKILLS}}")).toBeLessThan(
      config.systemPrompt.indexOf("{{MEMORY}}"),
    );
    // The vault's legacy section is untouched by the skills migration.
    expect(config.systemPrompt).toContain(LEGACY_VAULT_SECTION);

    // Migrate vault (owner-only endpoint) the same way.
    const vaultRes = await owner.post(`${agentBase}/vault/template-placeholder`, {});
    expect(vaultRes.status).toBe(200);
    const vaultDto = (await vaultRes.json()) as AgentVaultConfigDto;
    expect(vaultDto.templateHasPlaceholder).toBe(true);
    expect(vaultDto.legacySectionPresent).toBe(false);
    ({ config } = await getConfig());
    expect(config.systemPrompt).not.toContain(LEGACY_VAULT_SECTION);
    expect(config.systemPrompt.indexOf("{{VAULT}}")).toBeLessThan(
      config.systemPrompt.indexOf("{{SKILLS}}"),
    );

    // Idempotent: a second call changes nothing and still succeeds.
    const before = config.systemPrompt;
    expect((await owner.post(`${agentBase}/vault/template-placeholder`, {})).status).toBe(200);
    ({ config } = await getConfig());
    expect(config.systemPrompt).toBe(before);
  });

  it("inserts {{SCHEDULES}} before # Environment when there is nothing to migrate", async () => {
    expect(
      (await owner.put(configPath, { config: { systemPrompt: LEGACY_TEMPLATE } })).status,
    ).toBe(200);
    const res = await owner.post(`${agentBase}/schedules/template-placeholder`, {});
    expect(res.status).toBe(200);
    const dto = (await res.json()) as AgentSchedulesConfigDto;
    expect(dto.templateHasPlaceholder).toBe(true);
    const { config } = await getConfig();
    expect(config.systemPrompt.indexOf("{{SCHEDULES}}")).toBeGreaterThan(-1);
    expect(config.systemPrompt.indexOf("{{SCHEDULES}}")).toBeLessThan(
      config.systemPrompt.indexOf("# Environment"),
    );
  });

  it("gates the vault / schedules endpoints owner-only and 404s outsiders everywhere", async () => {
    // The endpoints follow their routers' modify conventions: skills is member-level
    // (exercised in the migration test above); vault / schedules are owner-only.
    expect((await member.post(`${agentBase}/vault/template-placeholder`, {})).status).toBe(403);
    expect((await member.post(`${agentBase}/schedules/template-placeholder`, {})).status).toBe(403);
    for (const feature of ["skills", "vault", "schedules"] as const) {
      expect((await outsider.post(`${agentBase}/${feature}/template-placeholder`, {})).status).toBe(
        404,
      );
    }
  });
});
