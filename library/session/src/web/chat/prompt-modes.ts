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
 *
 * A composer mode the Agent lacks is offered too: listed greyed with an install, which goes
 * through the same path as goal mode's (hook-plugin-install.ts). Existing Agents get no sweep
 * when a mode becomes a default install, so this offer is how they find it (PRFC-0033, compat C5
 * option a, pending the user's choice: `promptModeOffers` is the one place that decides it).
 */
import { useCallback, useMemo, useRef, useState } from "react";
import type {
  AgentPluginsInstallResponse,
  IconRef,
  PluginItem,
  PluginLibraryResponse,
} from "@prismshadow/penguin-server/api";
import { api, localizedText, toastApiError, useFreshRead, useLocale } from "@prismshadow/penguin-web/internal";

import { hookPluginInstall } from "./hook-plugin-install";

/** One switch as the composer shows it. */
export interface PromptMode {
  /** The plugin, which names its hook package too: what a Task lists in `promptHooks`. */
  name: string;
  title: string;
  description: string;
  composerCommand?: string;
  icon?: IconRef;
}

/** A composer mode the Agent lacks, offered for install in the "+" menu. */
export interface PromptModeOffer extends PromptMode {
  /** Its install is on its way. */
  installing: boolean;
}

/** What the Agent offers the composer: its switches, the modes it could install, and the install. */
export interface PromptModes {
  modes: PromptMode[];
  offers: PromptModeOffer[];
  /**
   * Installs an offered mode on the Agent. Resolves true once its switch is offered on the same
   * Agent; false when the install was refused (the reason is toasted) or the composer has moved
   * to another Agent meanwhile.
   */
  install: (name: string) => Promise<boolean>;
}

/** The composer's side of the switches: the ones the Agent offers, the ones on, and the change. */
export interface ComposerSwitches {
  modes: PromptMode[];
  on: string[];
  onChange: (names: string[]) => void;
  /** The modes the Agent lacks, each with an install (none without an Agent to install on). */
  offers?: PromptModeOffer[];
  install?: (name: string) => Promise<boolean>;
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
  | "composerCommand"
  | "icon"
>;

/** The library's composer-mode plugins, in library order. */
const composerModePlugins = (library: PluginLibraryResponse): ModeSource[] =>
  library.groups.flatMap((group) => group.plugins).filter((plugin) => plugin.composerMode === true);

const hookNames = (installs: AgentPluginsInstallResponse): Set<string> =>
  new Set(installs.hooks.map((hook) => hook.name));

/** The library's composer-mode plugins whose hook package the Agent has, in library order. */
export function promptModeSources(
  library: PluginLibraryResponse,
  installs: AgentPluginsInstallResponse,
): ModeSource[] {
  const installed = hookNames(installs);
  return composerModePlugins(library).filter((plugin) => installed.has(plugin.name));
}

/**
 * The library's composer-mode plugins the Agent lacks, in library order: what the "+" menu offers
 * to install. Compat C5 (a), pending the user's choice: return none here to offer nothing.
 */
export function promptModeOffers(
  library: PluginLibraryResponse,
  installs: AgentPluginsInstallResponse,
): ModeSource[] {
  const installed = hookNames(installs);
  return composerModePlugins(library).filter((plugin) => !installed.has(plugin.name));
}

/** One Agent's read: its switches' sources and the modes it could install. */
interface ModeRead {
  modes: ModeSource[];
  offers: ModeSource[];
}

/** The last answer per Agent in this page load, so a remount starts from it. */
const reads = new Map<string, ModeRead>();

/** The modes installed in this mount since the read landed, per Agent key. */
interface Installed {
  key: string;
  names: readonly string[];
}

/**
 * The switches the Agent offers and the modes it lacks, read from the server that holds it
 * (`machineId`, null = this one) on mount and whenever the Agent changes; none without an Agent,
 * or until the reads land. An install moves its mode from the offers to the switches at once.
 */
export function usePromptModes(
  projectId: string | null,
  agentId: string | null,
  machineId: string | null,
): PromptModes {
  const key = projectId && agentId ? [projectId, machineId ?? "", agentId].join("\0") : "";
  const { value } = useFreshRead(reads, key, async (): Promise<ModeRead> => {
    if (!projectId || !agentId) return { modes: [], offers: [] };
    const [library, installs] = await Promise.all([
      api.getPluginLibrary(machineId),
      api.getAgentPlugins(projectId, agentId, machineId),
    ]);
    return {
      modes: promptModeSources(library, installs),
      offers: promptModeOffers(library, installs),
    };
  });
  const [installed, setInstalled] = useState<Installed>({ key, names: [] });
  const [installing, setInstalling] = useState<Installed>({ key, names: [] });
  /** The Agent the composer is on now, for an install that answers after it moved on. */
  const current = useRef(key);
  current.current = key;
  const { locale } = useLocale();

  const install = useCallback(
    async (name: string): Promise<boolean> => {
      if (!projectId || !agentId) return false;
      const at = key;
      const add = (s: Installed): Installed => ({
        key: at,
        names: [...(s.key === at ? s.names : []), name],
      });
      const drop = (s: Installed): Installed =>
        s.key === at ? { key: at, names: s.names.filter((n) => n !== name) } : s;
      setInstalling(add);
      try {
        if (!(await hookPluginInstall(projectId, agentId, machineId, name).install())) return false;
        // A remount starts from the installed state; its own read confirms it.
        const cached = reads.get(at);
        const source = cached?.offers.find((plugin) => plugin.name === name);
        if (cached && source) {
          reads.set(at, {
            modes: [...cached.modes, source],
            offers: cached.offers.filter((plugin) => plugin.name !== name),
          });
        }
        setInstalled(add);
        return current.current === at;
      } catch (err) {
        toastApiError(err);
        return false;
      } finally {
        setInstalling(drop);
      }
    },
    [key, projectId, agentId, machineId],
  );

  return useMemo(() => {
    const added = installed.key === key ? installed.names : [];
    const busy = installing.key === key ? installing.names : [];
    const offers = value?.offers ?? [];
    // Library order holds across the move: the offers keep theirs, and a just-installed mode
    // goes after the switches the read found.
    const modes = [
      ...(value?.modes ?? []),
      ...offers.filter((plugin) => added.includes(plugin.name)),
    ];
    const view = (plugin: ModeSource): PromptMode => ({
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
      ...(plugin.composerCommand ? { composerCommand: plugin.composerCommand } : {}),
    });
    return {
      modes: modes.map(view),
      offers: offers
        .filter((plugin) => !added.includes(plugin.name))
        .map((plugin) => ({ ...view(plugin), installing: busy.includes(plugin.name) })),
      install,
    };
  }, [value, installed, installing, key, locale, install]);
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

/** One Session's switches: those the Agent offers, as stored for the Session, and its offers. */
export function useSessionSwitches(
  userId: string | null,
  sessionId: string | null,
  { modes, offers, install }: PromptModes,
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
  return useMemo(
    () => ({ modes, on, onChange, offers, install }),
    [modes, on, onChange, offers, install],
  );
}
