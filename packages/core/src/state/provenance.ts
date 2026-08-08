/**
 * Agent provenance fingerprint: a content-derived hash of the editable inputs that
 * determine an Agent's behavior (the system prompt template, AGENTS.md, installed skills,
 * tool contract, and model parameters).
 *
 * Why: the self-evolution loop appends an evaluation to `scoreboard.yaml` each round, but a
 * record only carries `version` + `provider` + `model_id`. `version` is a human-assigned
 * monotonic integer, not content-derived — so editing the system prompt / AGENTS.md / a skill
 * without bumping `version` leaves two evaluations looking identical while testing different
 * Agents, and score differences become unattributable. `agent_sha256` answers "did the config
 * change?" in one glance; the per-part sub-hashes answer "what changed?".
 *
 * The fingerprint hashes the **raw config inputs** (before placeholder substitution), NOT the
 * assembled `session_meta.system_prompt` — the assembled prompt embeds per-run values
 * (`{{DATE}}`, `{{SESSION_ID}}`, `{{CWD}}`) that vary every run and would make the hash useless
 * as a config identity.
 *
 * Reading follows the same degrade-to-null discipline as the rest of Agent State loading:
 * a missing AGENTS.md / skill file hashes an empty string rather than throwing.
 */
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { agentStateVersion } from "./default-config.js";
import { agentsMdPath, skillsDir } from "./paths.js";
import { buildToolConfig, listInstalledSkills, type AgentState } from "./agent-state.js";

/** Fingerprint of a single installed skill. */
export interface AgentSkillFingerprint {
  name: string;
  version: number;
  /** sha256 of the skill's full SKILL.md content. */
  sha256: string;
}

/** Optional model reference for the fingerprint (the model an evaluation ran on). */
export interface ProvenanceModelRef {
  provider: string;
  model_id: string;
}

/**
 * Content-derived provenance fingerprint of an Agent State.
 * Docs: /docs/self-improvement § "Provenance".
 */
export interface AgentProvenance {
  provenance_version: 1;
  /** Agent State version number (the `version` in system_config.yaml; treated as 1 if missing). */
  version: number;
  /** sha256 of the raw system_prompt template (before placeholder substitution). */
  system_prompt_sha256: string;
  /** sha256 of the full AGENTS.md content (empty string when the file is missing). */
  agents_md_sha256: string;
  /** sha256 of the canonicalized builtin tool contract (name + description + parameters). */
  tools_sha256: string;
  /** Per-skill fingerprints, sorted by name. */
  skills: AgentSkillFingerprint[];
  /** Order-independent combined hash of the skills array. */
  skills_sha256: string;
  /** The model this fingerprint is paired with (optional; e.g. the evaluation's model). */
  model?: ProvenanceModelRef;
  /** The effective thinking level (optional). */
  thinking_level?: string;
  /** Top-level fingerprint combining every field above — the single "did config change?" answer. */
  agent_sha256: string;
}

/** Recursively sort object keys so `JSON.stringify` is stable across machines/insertion order. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/** sha256 hex of a string. */
function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** sha256 hex of a value's canonical JSON form (key-order independent). */
function sha256Canonical(value: unknown): string {
  return sha256(JSON.stringify(canonicalize(value)));
}

/**
 * Builds the content-derived provenance fingerprint for an Agent State. The optional model /
 * thinking level are folded into the top-level `agent_sha256` when provided (so an evaluation on
 * a different model gets a distinct fingerprint), and echoed as their own fields.
 */
export async function buildAgentProvenance(
  state: AgentState,
  opts?: { model?: ProvenanceModelRef; thinkingLevel?: string },
): Promise<AgentProvenance> {
  const version = agentStateVersion(state.systemConfig);

  // Raw template, NOT the assembled prompt — assembly injects per-run environment values.
  const systemPromptSha = sha256(state.systemConfig.system_prompt);

  // AGENTS.md: degrade to an empty-string hash when missing (matches agent-state loading).
  const agentsMdText = await readFileOrEmpty(
    agentsMdPath(state.root, state.projectId, state.agentId),
  );
  const agentsMdSha = sha256(agentsMdText);

  // Tool contract: the full builtin tool definitions (name + description + parameters), since
  // description-driven behavior is part of what the model sees.
  const tools = buildToolConfig(state).customTools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters ?? null,
  }));
  const toolsSha = sha256Canonical(tools);

  // Skills: full SKILL.md content per installed skill, sorted by name.
  const installed = await listInstalledSkills(state.root, state.projectId, state.agentId);
  const dir = skillsDir(state.root, state.projectId, state.agentId);
  const skills: AgentSkillFingerprint[] = [];
  for (const skill of installed) {
    const content = await readFileOrEmpty(path.join(dir, skill.name, "SKILL.md"));
    skills.push({ name: skill.name, version: skill.version, sha256: sha256(content) });
  }
  skills.sort((a, b) => a.name.localeCompare(b.name));
  const skillsSha = sha256Canonical(skills);

  const agentSha = sha256Canonical({
    provenance_version: 1,
    version,
    system_prompt_sha256: systemPromptSha,
    agents_md_sha256: agentsMdSha,
    tools_sha256: toolsSha,
    skills_sha256: skillsSha,
    ...(opts?.model ? { model: opts.model } : {}),
    ...(opts?.thinkingLevel !== undefined ? { thinking_level: opts.thinkingLevel } : {}),
  });

  return {
    provenance_version: 1,
    version,
    system_prompt_sha256: systemPromptSha,
    agents_md_sha256: agentsMdSha,
    tools_sha256: toolsSha,
    skills,
    skills_sha256: skillsSha,
    ...(opts?.model ? { model: opts.model } : {}),
    ...(opts?.thinkingLevel !== undefined ? { thinking_level: opts.thinkingLevel } : {}),
    agent_sha256: agentSha,
  };
}

/** Reads a file's text, returning "" when it's missing (degrade-to-null discipline). */
async function readFileOrEmpty(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return "";
  }
}
