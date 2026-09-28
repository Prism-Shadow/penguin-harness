/**
 * What the Local CLI panel shows for each coding agent, built from the saved definitions and
 * the server's discovery: which agents are installed (the CLI was found, or an admin saved a
 * command for it) and which are only available, each agent's command, version and sign-in
 * state, and the model and reasoning options it advertised when last probed. Pure, so the
 * merge rules are pinned by tests rather than by a rendered page.
 */
import type {
  CodingAgentConfigOption,
  CodingAgentDiscoveryResponse,
  CodingAgentServerInfo,
} from "@prismshadow/penguin-server/api";

export interface AgentCardModel {
  key: string;
  agentId: string;
  title: string;
  /** Who makes it ("OpenAI official CLI"); absent for custom agents. */
  vendor?: string;
  commandLine: string;
  saved: boolean;
  /** A session can start: a saved command, or a detected CLI with a runnable launch. */
  startable: boolean;
  version?: string;
  authStatus?: "ok" | "missing" | "unknown";
  /** How the agent signs in on the server machine; shown when it is not signed in. */
  authHint?: string;
  setupHint?: string | null;
  homepageUrl?: string;
  /** The one command that installs the agent, when there is one for every OS. */
  installCommand?: string;
  /** Why the last probe could not open a session with it; empty when not an admin. */
  probeError?: string;
  /** Everything the agent advertised on its last probe; absent until a Rescan has run. */
  options?: CodingAgentConfigOption[];
  rememberedModel?: { configId: string; value: boolean | string; name?: string } | null;
  /** Other remembered settings (a reasoning effort), by config option id. */
  rememberedOptions?: Record<string, boolean | string>;
}

/** One line on who makes each known agent, shown after its name. */
export const AGENT_VENDORS: Record<string, string> = {
  claude: "Anthropic official CLI",
  codex: "OpenAI official CLI",
  gemini: "Google official CLI",
  opencode: "Open-source agent CLI",
  copilot: "GitHub coding CLI",
  cline: "Open-source agent CLI",
  devin: "Cognition terminal CLI",
  hermes: "Nous Research agent CLI",
  kilo: "Kilo Code CLI",
  kimi: "Moonshot Kimi CLI",
  kiro: "Kiro agent CLI",
  trae: "ByteDance coding CLI",
  vibe: "Mistral open-source CLI",
};

export function buildAgentCards(
  saved: CodingAgentServerInfo[],
  discovery: CodingAgentDiscoveryResponse | null,
  setupRequired: string,
): { installed: AgentCardModel[]; available: AgentCardModel[] } {
  const installed: AgentCardModel[] = [];
  const available: AgentCardModel[] = [];
  const seen = new Set<string>();
  for (const candidate of discovery?.candidates ?? []) {
    seen.add(candidate.recipeId);
    const definition = saved.find((a) => a.id === candidate.recipeId);
    // "Installed" gates on detection: an npx-run adapter can resolve while the agent itself
    // is absent, and a launch alone never proves the agent is on the machine.
    const usable = candidate.detected || definition !== undefined;
    const commandLine = definition
      ? [definition.command, ...definition.args].join(" ")
      : candidate.launch !== null
        ? [candidate.launch.command, ...candidate.launch.args].join(" ")
        : "";
    const vendor = AGENT_VENDORS[candidate.recipeId];
    // A saved definition's own probe wins: its sessions run the saved command.
    const options = discovery?.agentModels[candidate.recipeId] ?? candidate.models;
    const probeError = definition
      ? discovery?.agentErrors?.[candidate.recipeId]
      : candidate.probeError;
    const card: AgentCardModel = {
      key: `recipe:${candidate.recipeId}`,
      agentId: candidate.recipeId,
      title: definition?.title ?? candidate.title,
      ...(vendor !== undefined ? { vendor } : {}),
      commandLine,
      saved: definition !== undefined || candidate.alreadyAdded,
      startable: definition !== undefined || (candidate.detected && candidate.launch !== null),
      ...(candidate.version !== undefined ? { version: candidate.version } : {}),
      ...(candidate.authStatus !== undefined ? { authStatus: candidate.authStatus } : {}),
      ...(candidate.authHint !== "" ? { authHint: candidate.authHint } : {}),
      setupHint: candidate.launch === null ? (candidate.setupHint ?? setupRequired) : null,
      homepageUrl: candidate.homepageUrl,
      ...(candidate.installCommand !== undefined
        ? { installCommand: candidate.installCommand }
        : {}),
      ...(probeError !== undefined ? { probeError } : {}),
      ...(options !== undefined ? { options } : {}),
      rememberedModel: definition?.rememberedModel ?? candidate.rememberedModel ?? null,
      ...((definition?.rememberedOptions ?? candidate.rememberedOptions)
        ? { rememberedOptions: definition?.rememberedOptions ?? candidate.rememberedOptions }
        : {}),
    };
    (usable ? installed : available).push(card);
  }
  for (const agent of saved) {
    if (seen.has(agent.id)) continue;
    const options = discovery?.agentModels[agent.id];
    const probeError = discovery?.agentErrors?.[agent.id];
    installed.push({
      key: `def:${agent.id}`,
      agentId: agent.id,
      title: agent.title ?? agent.id,
      commandLine: [agent.command, ...agent.args].join(" "),
      saved: true,
      startable: true,
      ...(options !== undefined ? { options } : {}),
      ...(probeError !== undefined ? { probeError } : {}),
      rememberedModel: agent.rememberedModel ?? null,
      ...(agent.rememberedOptions ? { rememberedOptions: agent.rememberedOptions } : {}),
    });
  }
  return { installed, available };
}

/**
 * Whether an installed agent can run a prompt now, as one word for its card: `ready` when it
 * can start and is signed in; `signIn` when its login is missing, which outranks everything
 * because nothing else works until it is fixed; `setup` when it is found but nothing can
 * launch it; `failed` when the last probe could not open a session with it; `unknown` when
 * it can start but no sign-in check could tell.
 */
export type CardReadiness = "ready" | "signIn" | "setup" | "failed" | "unknown";

export function cardReadiness(card: AgentCardModel): CardReadiness {
  if (card.authStatus === "missing") return "signIn";
  if (!card.startable) return "setup";
  if (card.probeError !== undefined) return "failed";
  return card.authStatus === "ok" ? "ready" : "unknown";
}

/** The option an agent renders as its Model: the `model` category, else the first select. */
export function modelOptionOf(
  options: CodingAgentConfigOption[] | undefined,
): CodingAgentConfigOption | undefined {
  return (
    options?.find((o) => o.category === "model" && o.type === "select") ??
    options?.find((o) => o.type === "select")
  );
}

/** The agent's reasoning-effort option, when it advertises one. */
export function effortOptionOf(
  options: CodingAgentConfigOption[] | undefined,
): CodingAgentConfigOption | undefined {
  return options?.find((o) => o.category === "thought_level" && o.type === "select");
}

/** The model a card shows as current: the remembered pick when it fits, else the agent's own. */
export function currentModel(card: AgentCardModel): { value: string; name: string } | null {
  const option = modelOptionOf(card.options);
  const remembered = card.rememberedModel;
  if (option === undefined) {
    return remembered != null
      ? { value: String(remembered.value), name: remembered.name ?? String(remembered.value) }
      : null;
  }
  const value = String(
    remembered != null && remembered.configId === option.id
      ? remembered.value
      : option.currentValue,
  );
  return { value, name: option.options.find((o) => o.value === value)?.name ?? value };
}
