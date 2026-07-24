/**
 * Agent config read/write (config is an editable file).
 *
 * system_config.yaml is edited via yaml's `parseDocument`: only the keys provided in
 * the request are updated, the rest of the file (including comments) is preserved
 * as-is; AGENTS.md is overwritten in full.
 * The vault (agent_state/.vault.toml) is read/written via core's loadAgentVault/saveAgentVault;
 * plaintext values only ever hit disk, and are always masked in responses.
 */
import fs from "node:fs/promises";
import { parseDocument, parse as parseYaml } from "yaml";
import {
  agentsMdPath,
  agentStateDir,
  agentStateVersion,
  VAULT_VALUE_MAX_LENGTH,
  isValidVaultKey,
  loadAgentVault,
  saveAgentVault,
  systemConfigPath,
} from "@prismshadow/penguin-core";
import type {
  MCPServerConfig,
  ThinkingLevelName,
  ToolDefinitionConfig,
} from "@prismshadow/penguin-core";
import type {
  AgentConfigDto,
  AgentConfigUpdateRequest,
  AgentModelConfigDto,
  AgentCompactionConfigDto,
  VaultEntryInfo,
  VaultResponse,
  VaultUpdateRequest,
} from "../api/types.js";
import { HttpError } from "../http/errors.js";
import {
  badRequest,
  optionalBoolean,
  optionalEnum,
  optionalNumber,
  optionalString,
} from "../http/validate.js";
import { maskApiKey } from "./project-config-service.js";

const THINKING_LEVELS: readonly ThinkingLevelName[] = ["none", "low", "medium", "high", "xhigh"];
const COMPACTION_MODES = ["summarize", "discard"] as const;

function asRecord(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

export interface AgentConfigView {
  agentsMd: string;
  systemConfigYaml: string;
  config: AgentConfigDto;
  stateDir: string;
}

export class AgentConfigService {
  constructor(private readonly root: string) {}

  /** Whether the Agent exists (determined by the presence of system_config.yaml, matching the CLI's convention). */
  async exists(projectId: string, agentId: string): Promise<boolean> {
    try {
      await fs.access(systemConfigPath(this.root, projectId, agentId));
      return true;
    } catch {
      return false;
    }
  }

  async requireExists(projectId: string, agentId: string): Promise<void> {
    if (!(await this.exists(projectId, agentId))) {
      throw new HttpError(404, "agent_not_found", "Agent does not exist.");
    }
  }

  /**
   * Read list-card metadata: name / description + tool count (sum of tools.builtin
   * and tools.mcpServers entries; MCP counted per server). Silently falls back to
   * empty / 0 if the file is corrupt.
   */
  async readCardMeta(
    projectId: string,
    agentId: string,
  ): Promise<{ name?: string; description?: string; toolCount: number; version: number }> {
    try {
      const raw = await fs.readFile(systemConfigPath(this.root, projectId, agentId), "utf8");
      const parsed = asRecord(parseYaml(raw));
      const tools = asRecord(parsed.tools);
      const countOf = (v: unknown): number => (Array.isArray(v) ? v.length : 0);
      return {
        ...(typeof parsed.name === "string" ? { name: parsed.name } : {}),
        ...(typeof parsed.description === "string" ? { description: parsed.description } : {}),
        toolCount: countOf(tools.builtin) + countOf(tools.mcpServers),
        version: agentStateVersion({ version: parsed.version as number | undefined }),
      };
    } catch {
      return { toolCount: 0, version: 1 };
    }
  }

  /** Structured config view (matching the edit form's shape) + raw text + AGENTS.md + State path. */
  async getConfig(projectId: string, agentId: string): Promise<AgentConfigView> {
    await this.requireExists(projectId, agentId);
    const yamlPath = systemConfigPath(this.root, projectId, agentId);
    const systemConfigYaml = await fs.readFile(yamlPath, "utf8");
    const parsed = asRecord(parseYaml(systemConfigYaml));
    const model = asRecord(parsed.model);
    const compaction = asRecord(parsed.compaction);
    const tools = asRecord(parsed.tools);

    let agentsMd = "";
    try {
      agentsMd = await fs.readFile(agentsMdPath(this.root, projectId, agentId), "utf8");
    } catch {
      // Treat a missing AGENTS.md as an empty file (it normally exists after initialization).
    }

    const modelDto: AgentModelConfigDto = {
      ...(typeof model.max_tokens === "number" ? { maxTokens: model.max_tokens } : {}),
      ...(typeof model.thinking_level === "string"
        ? { thinkingLevel: model.thinking_level as ThinkingLevelName }
        : {}),
      ...(typeof model.timeoutMs === "number" ? { timeoutMs: model.timeoutMs } : {}),
    };
    const compactionDto: AgentCompactionConfigDto = {
      ...(typeof compaction.max_context_length === "number"
        ? { maxContextLength: compaction.max_context_length }
        : {}),
      ...(typeof compaction.max_session_turns === "number"
        ? { maxSessionTurns: compaction.max_session_turns }
        : {}),
      ...(compaction.mode === "summarize" || compaction.mode === "discard"
        ? { mode: compaction.mode }
        : {}),
      ...(typeof compaction.prompt === "string" ? { prompt: compaction.prompt } : {}),
    };
    const config: AgentConfigDto = {
      ...(typeof parsed.name === "string" ? { name: parsed.name } : {}),
      ...(typeof parsed.description === "string" ? { description: parsed.description } : {}),
      version: agentStateVersion({ version: parsed.version as number | undefined }),
      systemPrompt: typeof parsed.system_prompt === "string" ? parsed.system_prompt : "",
      ...(typeof parsed.max_turns === "number" ? { maxTurns: parsed.max_turns } : {}),
      ...(Object.keys(modelDto).length > 0 ? { model: modelDto } : {}),
      ...(Object.keys(compactionDto).length > 0 ? { compaction: compactionDto } : {}),
      toolsBuiltin: Array.isArray(tools.builtin) ? (tools.builtin as ToolDefinitionConfig[]) : [],
      mcpServers: Array.isArray(tools.mcpServers) ? (tools.mcpServers as MCPServerConfig[]) : [],
      // Only a stored boolean is surfaced; a missing field stays missing (semantics: enabled).
      ...(typeof tools.call_descriptions === "boolean"
        ? { callDescriptions: tools.call_descriptions }
        : {}),
    };
    return {
      agentsMd,
      systemConfigYaml,
      config,
      stateDir: agentStateDir(this.root, projectId, agentId),
    };
  }

  /**
   * PUT accepts any subset: only the provided keys are updated (parseDocument
   * preserves comments and untouched content); agentsMd is overwritten in full.
   * Numeric validation: >0 or -1; thinkingLevel / mode are validated as enums.
   */
  async updateConfig(
    projectId: string,
    agentId: string,
    req: AgentConfigUpdateRequest,
  ): Promise<void> {
    await this.requireExists(projectId, agentId);
    // Finish all config validation and document changes before writing to disk
    // (if validation fails, AGENTS.md is not written either, avoiding a partial update).
    if (req.config !== undefined) {
      await this.applyConfigUpdate(projectId, agentId, req.config);
    }
    if (req.agentsMd !== undefined) {
      await fs.writeFile(agentsMdPath(this.root, projectId, agentId), req.agentsMd, "utf8");
    }
  }

  private async applyConfigUpdate(
    projectId: string,
    agentId: string,
    config: NonNullable<AgentConfigUpdateRequest["config"]>,
  ): Promise<void> {
    const cfg = config as unknown as Record<string, unknown>;
    const yamlPath = systemConfigPath(this.root, projectId, agentId);
    const doc = parseDocument(await fs.readFile(yamlPath, "utf8"));

    const setIfProvided = (path: string[], value: unknown): void => {
      if (value !== undefined) doc.setIn(path, value);
    };

    setIfProvided(["name"], optionalString(cfg, "name", { maxLen: 100, label: "name" }));
    setIfProvided(
      ["description"],
      optionalString(cfg, "description", { maxLen: 2000, label: "description" }),
    );
    setIfProvided(
      ["system_prompt"],
      optionalString(cfg, "systemPrompt", { label: "systemPrompt" }),
    );
    setIfProvided(
      ["max_turns"],
      optionalNumber(cfg, "maxTurns", { integer: true, positiveOrMinusOne: true }),
    );

    if (cfg.model !== undefined) {
      const model = asRecord(cfg.model);
      setIfProvided(
        ["model", "max_tokens"],
        optionalNumber(model, "maxTokens", { integer: true, positiveOrMinusOne: true }),
      );
      setIfProvided(
        ["model", "thinking_level"],
        optionalEnum(model, "thinkingLevel", THINKING_LEVELS),
      );
      setIfProvided(
        ["model", "timeoutMs"],
        optionalNumber(model, "timeoutMs", { integer: true, positiveOrMinusOne: true }),
      );
    }
    if (cfg.compaction !== undefined) {
      const compaction = asRecord(cfg.compaction);
      setIfProvided(
        ["compaction", "max_context_length"],
        optionalNumber(compaction, "maxContextLength", { integer: true, positiveOrMinusOne: true }),
      );
      setIfProvided(
        ["compaction", "max_session_turns"],
        optionalNumber(compaction, "maxSessionTurns", { integer: true, positiveOrMinusOne: true }),
      );
      setIfProvided(["compaction", "mode"], optionalEnum(compaction, "mode", COMPACTION_MODES));
      setIfProvided(["compaction", "prompt"], optionalString(compaction, "prompt"));
    }
    if (cfg.toolsBuiltin !== undefined) {
      doc.setIn(["tools", "builtin"], validateToolsBuiltin(cfg.toolsBuiltin));
    }
    if (cfg.mcpServers !== undefined) {
      doc.setIn(["tools", "mcpServers"], validateMcpServers(cfg.mcpServers));
    }
    setIfProvided(
      ["tools", "call_descriptions"],
      optionalBoolean(cfg, "callDescriptions", "callDescriptions"),
    );

    await fs.writeFile(yamlPath, doc.toString(), "utf8");
  }

  /** Read the Agent vault (agent_state/.vault.toml): values are always masked, plaintext is never sent to the client. */
  async getVault(projectId: string, agentId: string): Promise<VaultResponse> {
    await this.requireExists(projectId, agentId);
    const vault = await loadAgentVault(this.root, projectId, agentId);
    const entries: VaultEntryInfo[] = Object.entries(vault).map(([key, value]) => ({
      key,
      valueMasked: maskApiKey(value),
    }));
    return { entries };
  }

  /**
   * PUT replaces the whole vault table (same semantics as models): keys absent from
   * the body are deleted; omitting value keeps the existing value (a new key must
   * provide a value). Key names are validated against shell environment variable
   * naming rules (same rule as core); deleting everything removes the whole
   * .vault.toml file.
   */
  async updateVault(
    projectId: string,
    agentId: string,
    req: VaultUpdateRequest,
  ): Promise<VaultResponse> {
    await this.requireExists(projectId, agentId);
    const prev = await loadAgentVault(this.root, projectId, agentId);

    const seen = new Set<string>();
    const nextVault: Record<string, string> = {};
    for (const entry of req.entries) {
      if (!isValidVaultKey(entry.key)) {
        throw badRequest(
          `Invalid vault key name: ${entry.key} (letters, digits and underscores only, and must not start with a digit).`,
        );
      }
      if (seen.has(entry.key)) {
        throw badRequest(`entries contains a duplicate key: ${entry.key}.`);
      }
      seen.add(entry.key);
      const prevValue = prev[entry.key];
      if (entry.value !== undefined) {
        // Values are injected into the child process environment: an oversized value would
        // make exec spawn fail (E2BIG), so we reject it on write (same limit as core).
        if (entry.value.length > VAULT_VALUE_MAX_LENGTH) {
          throw badRequest(
            `Vault value too long: ${entry.key} (limit ${VAULT_VALUE_MAX_LENGTH} characters).`,
          );
        }
        nextVault[entry.key] = entry.value;
      } else if (prevValue !== undefined) {
        nextVault[entry.key] = prevValue;
      } else {
        throw badRequest(`New key ${entry.key} must provide a value.`);
      }
    }

    await saveAgentVault(this.root, projectId, agentId, nextVault);
    return this.getVault(projectId, agentId);
  }
}

function validateToolsBuiltin(value: unknown): ToolDefinitionConfig[] {
  if (!Array.isArray(value)) throw badRequest("toolsBuiltin must be an array.");
  return value.map((item, i) => {
    const t = asRecord(item);
    if (typeof t.name !== "string" || t.name.length === 0) {
      throw badRequest(`toolsBuiltin[${i}].name must be a non-empty string.`);
    }
    if (typeof t.description !== "string") {
      throw badRequest(`toolsBuiltin[${i}].description must be a string.`);
    }
    if (t.permission !== undefined && t.permission !== "r" && t.permission !== "rw") {
      throw badRequest(`toolsBuiltin[${i}].permission must be one of r / rw.`);
    }
    if (t.forModel !== undefined && t.forModel !== "vision" && t.forModel !== "text-only") {
      throw badRequest(`toolsBuiltin[${i}].forModel must be one of vision / text-only.`);
    }
    optionalNumber(t, "timeoutMs", {
      integer: true,
      positiveOrMinusOne: true,
      label: `toolsBuiltin[${i}].timeoutMs`,
    });
    optionalNumber(t, "maxOutputLength", {
      integer: true,
      positiveOrMinusOne: true,
      label: `toolsBuiltin[${i}].maxOutputLength`,
    });
    return t as unknown as ToolDefinitionConfig;
  });
}

function validateMcpServers(value: unknown): MCPServerConfig[] {
  if (!Array.isArray(value)) throw badRequest("mcpServers must be an array.");
  return value.map((item, i) => {
    const s = asRecord(item);
    if (typeof s.name !== "string" || s.name.length === 0) {
      throw badRequest(`mcpServers[${i}].name must be a non-empty string.`);
    }
    if (s.config === null || typeof s.config !== "object" || Array.isArray(s.config)) {
      throw badRequest(`mcpServers[${i}].config must be an object.`);
    }
    return s as unknown as MCPServerConfig;
  });
}
