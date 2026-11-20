/**
 * The composer's switches. A plugin whose card sets `composerMode` (`PluginItem.composerMode`)
 * offers its hook package as a switch in the "+" menu of every conversation whose Agent has that
 * package installed. While a switch is on, every Task the composer sends names the package in
 * `TaskCreateRequest.promptHooks`: the server runs the package's `trigger: "host"` `user_prompt`
 * command and sends its context right behind the message, where the conversation shows it as a
 * folded "injected by harness" card. Nothing here knows a package by name.
 *
 * Which switches are on is the composer's state for one conversation, kept in this browser: a
 * draft carries it in its cache (`DraftCache.promptHooks`), a Session under a key of its own, since
 * a Session's draft is discarded on every send and a switch stays on until it is turned off. A
 * switch the Agent no longer offers is neither shown nor sent.
 */
import { useCallback, useMemo, useState } from "react";
import type {
  AgentPluginsInstallResponse,
  IconRef,
  PluginItem,
  PluginLibraryResponse,
} from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { localizedText } from "../../lib/skill-use";
import { useFreshRead } from "../../lib/use-fresh-read";
import { useLocale } from "../../state/locale";

/** One switch as the composer shows it. */
export interface PromptMode {
  /** The plugin, which names its hook package too: what a Task lists in `promptHooks`. */
  name: string;
  title: string;
  description: string;
  icon?: IconRef;
}

/** The composer's side of the switches: the ones the Agent offers, the ones on, and the change. */
export interface ComposerSwitches {
  modes: PromptMode[];
  on: string[];
  onChange: (names: string[]) => void;
}

type ModeSource = Pick<
  PluginItem,
  | "name"
  | "title"
  | "titleZh"
  | "description"
  | "descriptionZh"
  | "shortDescription"
  | "shortDescriptionZh"
  | "icon"
>;

/** The library's composer-mode plugins whose hook package the Agent has, in library order. */
export function promptModeSources(
  library: PluginLibraryResponse,
  installs: AgentPluginsInstallResponse,
): ModeSource[] {
  const installed = new Set(installs.hooks.map((hook) => hook.name));
  return library.groups
    .flatMap((group) => group.plugins)
    .filter((plugin) => plugin.composerMode === true && installed.has(plugin.name));
}

/** The last answer per Agent in this page load, so a remount starts from it. */
const reads = new Map<string, ModeSource[]>();

/**
 * The switches the Agent offers, read from the server that holds it (`machineId`, null = this one)
 * on mount and whenever the Agent changes; none without an Agent, or until the reads land.
 */
export function usePromptModes(
  projectId: string | null,
  agentId: string | null,
  machineId: string | null,
): PromptMode[] {
  const key = projectId && agentId ? [projectId, machineId ?? "", agentId].join("\0") : "";
  const { value } = useFreshRead(reads, key, async () => {
    if (!projectId || !agentId) return [];
    const [library, installs] = await Promise.all([
      api.getPluginLibrary(machineId),
      api.getAgentPlugins(projectId, agentId, machineId),
    ]);
    return promptModeSources(library, installs);
  });
  const { locale } = useLocale();
  return useMemo(
    () =>
      (value ?? []).map((plugin) => ({
        name: plugin.name,
        title: localizedText(locale, plugin.title || plugin.name, plugin.titleZh),
        description:
          locale === "zh"
            ? plugin.shortDescriptionZh ||
              plugin.descriptionZh ||
              plugin.shortDescription ||
              plugin.description
            : plugin.shortDescription || plugin.description,
        ...(plugin.icon !== undefined ? { icon: plugin.icon } : {}),
      })),
    [value, locale],
  );
}

/** The names among `names` that `modes` offers. */
export function offered(names: readonly string[], modes: readonly PromptMode[]): string[] {
  return names.filter((name) => modes.some((mode) => mode.name === name));
}

/** The `promptHooks` part of a Task request: the switches on, or nothing when none is. */
export function promptHooksField(on: readonly string[]): { promptHooks?: string[] } {
  return on.length > 0 ? { promptHooks: [...on] } : {};
}

/** `names` with `name` turned on, or off when it was on. */
export function toggled(names: readonly string[], name: string): string[] {
  return names.includes(name) ? names.filter((n) => n !== name) : [...names, name];
}

/** The storage key of one Session's switches: per account, so another sign-in never inherits them. */
const sessionKey = (userId: string, sessionId: string): string =>
  `penguin.promptModes.${userId}.${sessionId}`;

/** A Session's switches as stored; none when nothing is stored or storage cannot be read. */
export function loadSessionPromptModes(userId: string, sessionId: string): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(sessionKey(userId, sessionId)) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((n): n is string => typeof n === "string") : [];
  } catch {
    return [];
  }
}

/** Stores a Session's switches (none removes the key); a refused write keeps them for this page only. */
export function saveSessionPromptModes(userId: string, sessionId: string, names: string[]): void {
  try {
    if (names.length === 0) localStorage.removeItem(sessionKey(userId, sessionId));
    else localStorage.setItem(sessionKey(userId, sessionId), JSON.stringify(names));
  } catch {
    /* Storage refused (quota, blocked site data): the switches hold until the page goes. */
  }
}

/** One Session's switches: those the Agent offers, as stored for the Session. */
export function useSessionSwitches(
  userId: string | null,
  sessionId: string | null,
  modes: PromptMode[],
): ComposerSwitches {
  const key = userId && sessionId ? `${userId}\0${sessionId}` : "";
  const read = () => ({
    key,
    names: userId && sessionId ? loadSessionPromptModes(userId, sessionId) : [],
  });
  const [stored, setStored] = useState(read);
  // Another Session (the page keeps this hook across conversations): read its own switches now.
  let current = stored;
  if (stored.key !== key) {
    current = read();
    setStored(current);
  }
  const names = current.names;
  const onChange = useCallback(
    (next: string[]) => {
      if (!userId || !sessionId) return;
      saveSessionPromptModes(userId, sessionId, next);
      setStored({ key, names: next });
    },
    [key, userId, sessionId],
  );
  const on = useMemo(() => offered(names, modes), [names, modes]);
  return useMemo(() => ({ modes, on, onChange }), [modes, on, onChange]);
}
