/**
 * Handing a Project's sandbox command policy and new-chat defaults to the machines that Project
 * was given to.
 *
 * Both act where a Session runs: the command policy is threaded into a Session's Environment by
 * the server that creates it, and the Project's default thinking level is what an Agent over
 * there falls back to. A machine left with its own copies denies other commands than the ones
 * this Project lists, so these travel with the models (models-sync.ts).
 *
 * Each goes through the far side's own PUT, a whole-block replace that validates what it is
 * handed exactly as an edit on that machine's page would be.
 *
 * Two values of the new-chat defaults name things on THIS server. The workspace is a directory
 * here and means nothing there, so the machine keeps its own. The default Agent may not exist
 * there: a machine that refuses it keeps its own default Agent, and the rest of the block still
 * lands.
 */
import { effectiveCommandPolicyRules } from "@prismshadow/penguin-core";
import type { ProjectConfig } from "@prismshadow/penguin-core";
import type { ChatDefaultsDto, CommandPolicyRuleDto } from "../api/types.js";
import type { MachineApi } from "./machine-api.js";

/** This side's half: the two blocks as the far side's PUTs take them. */
export interface LocalSettings {
  commandPolicy: { enabled: boolean; rules: CommandPolicyRuleDto[] };
  chatDefaults: ChatDefaultsDto;
}

/**
 * The two blocks of a Project's config, read as this server enforces them: a policy the file
 * does not store is the factory set (core's one fallback), so the machine is handed the rules
 * this Project runs under rather than its own idea of the defaults.
 */
export function localSettings(
  config: Pick<ProjectConfig, "command_policy" | "default_chat">,
): LocalSettings {
  const policy = config.command_policy;
  const chat = config.default_chat ?? {};
  return {
    commandPolicy: {
      enabled: policy?.enabled !== false,
      rules: effectiveCommandPolicyRules(policy).map((rule) => ({
        name: rule.name,
        pattern: rule.pattern,
        ...(rule.description !== undefined ? { description: rule.description } : {}),
        enabled: rule.enabled !== false,
      })),
    },
    chatDefaults: {
      ...(chat.agent_id !== undefined ? { agentId: chat.agent_id } : {}),
      ...(chat.workspace !== undefined ? { workspace: chat.workspace } : {}),
      ...(chat.approval_mode !== undefined ? { approvalMode: chat.approval_mode } : {}),
      ...(chat.thinking_level !== undefined ? { thinkingLevel: chat.thinking_level } : {}),
    },
  };
}

/** Which of the two blocks a refusal is about. */
export type SettingsPart = "command policy" | "new-chat defaults";

/** What a sync did, in the words the job log shows. */
export interface SettingsSyncOutcome {
  /** Projects whose two blocks were both written on that machine. */
  projects: string[];
  /** What the machine kept as its own while the rest landed: a default Agent it does not have. */
  notes: { projectId: string; detail: string }[];
  /** Each block the machine would not take, with its own reason; the others still went. */
  refused: { projectId: string; part: SettingsPart; detail: string }[];
}

const accepted = (status: number) => status >= 200 && status < 300;

/** A refusal's words: the status, and the machine's own answer. */
const answered = (res: { status: number; text: string }) =>
  `it answered ${res.status}: ${res.text.slice(0, 200)}`;

/** The error code of a refusal the far side's server wrote (`{ error: { code } }`), or null. */
function errorCode(text: string): string | null {
  try {
    const code = (JSON.parse(text) as { error?: { code?: unknown } }).error?.code;
    return typeof code === "string" ? code : null;
  } catch {
    return null;
  }
}

/** The machine's own new-chat defaults, read leniently: anything unreadable reads as none set. */
function chatDefaultsIn(text: string): ChatDefaultsDto {
  try {
    const body = JSON.parse(text) as Record<string, unknown>;
    return {
      ...(typeof body.agentId === "string" ? { agentId: body.agentId } : {}),
      ...(typeof body.workspace === "string" ? { workspace: body.workspace } : {}),
    };
  } catch {
    return {};
  }
}

/** Writes the new-chat defaults: ours, with the machine's own workspace, and its own default Agent when it lacks ours. */
async function putChatDefaults(
  api: MachineApi,
  path: string,
  ours: ChatDefaultsDto,
): Promise<{ ok: true; note?: string } | { ok: false; detail: string }> {
  const current = await api.request("GET", path);
  if (current.status !== 200) return { ok: false, detail: answered(current) };
  const theirs = chatDefaultsIn(current.text);
  const { workspace: _here, ...rest } = ours;
  const body: ChatDefaultsDto = {
    ...rest,
    ...(theirs.workspace !== undefined ? { workspace: theirs.workspace } : {}),
  };
  const wrote = await api.request("PUT", path, body);
  if (accepted(wrote.status)) return { ok: true };
  if (body.agentId === undefined || errorCode(wrote.text) !== "unknown_agent") {
    return { ok: false, detail: answered(wrote) };
  }
  const { agentId: missing, ...others } = body;
  const kept = await api.request("PUT", path, {
    ...others,
    ...(theirs.agentId !== undefined ? { agentId: theirs.agentId } : {}),
  });
  return accepted(kept.status)
    ? { ok: true, note: `that machine has no Agent ${missing}, so it keeps its own default Agent` }
    : { ok: false, detail: answered(kept) };
}

/**
 * Writes each Project's command policy and new-chat defaults to that machine. A block the
 * machine refuses is reported and the next one still goes; a channel that gives out is reported
 * for that Project, as nothing else of it would land either.
 */
export async function syncSettingsToMachine(opts: {
  api: MachineApi;
  /** This side's blocks for a Project; a rejection (an unreadable config) skips it. */
  loadLocal: (projectId: string) => Promise<LocalSettings>;
  /** The Projects this machine is used by. */
  projects: readonly string[];
}): Promise<SettingsSyncOutcome> {
  const outcome: SettingsSyncOutcome = { projects: [], notes: [], refused: [] };
  for (const projectId of opts.projects) {
    let local: LocalSettings;
    try {
      local = await opts.loadLocal(projectId);
    } catch {
      continue;
    }
    const base = `/api/projects/${encodeURIComponent(projectId)}`;
    let part: SettingsPart = "command policy";
    try {
      const policy = await opts.api.request("PUT", `${base}/command-policy`, local.commandPolicy);
      const policyOk = accepted(policy.status);
      if (!policyOk) outcome.refused.push({ projectId, part, detail: answered(policy) });
      part = "new-chat defaults";
      const chat = await putChatDefaults(opts.api, `${base}/chat-defaults`, local.chatDefaults);
      if (!chat.ok) outcome.refused.push({ projectId, part, detail: chat.detail });
      else if (chat.note !== undefined) outcome.notes.push({ projectId, detail: chat.note });
      if (policyOk && chat.ok) outcome.projects.push(projectId);
    } catch (err) {
      outcome.refused.push({
        projectId,
        part,
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return outcome;
}
