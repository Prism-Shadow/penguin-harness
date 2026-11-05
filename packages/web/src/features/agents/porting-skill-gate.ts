/**
 * The import dialog's migration check: the chat it opens asks the Project's default agent to use
 * the `agent-porting` Skill, which ships in the `skill-porting` library plugin. A default agent
 * initialized before that Skill existed does not carry it, and installing a plugin is the only
 * thing that brings a new Skill to an Agent — so the dialog asks the Agent's installs when the
 * migration section opens, and while the Skill is missing it says so, offers the install, and
 * holds the chat until the Skill is there.
 *
 * Installing again is the plugin's update: every part of it the Agent already carries — on an
 * upgraded install, the `skill-porting` and `plugin-porting` Skills — is replaced by the library
 * copy, local edits included. So the gate also says which parts the install would rewrite, for
 * the dialog to confirm first, as the Plugins page's update does; `null` when the library could
 * not be read, which the dialog confirms without the list.
 *
 * A list that cannot be read holds nothing: the prompt itself tells the agent to stop when the
 * Skill is unavailable. A refused install keeps the Skill missing and says why, the server's
 * reason included; so does an install that landed without it (a library copy older than the
 * Skill). An answer for an Agent the dialog is no longer asking about lands nowhere.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { PluginItem } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { apiErrorText } from "../../lib/api-error";
import { S } from "../../lib/strings";
import { installsOf } from "../plugins/agent-installs";
import { changedParts } from "../plugins/plugin-status";
import type { AgentInstalls, ChangedPart } from "../plugins/plugin-status";

/** The Skill the migration prompt names. */
export const PORTING_SKILL = "agent-porting";
/** The library plugin that ships it. */
export const PORTING_PLUGIN = "skill-porting";

/** `unknown`: no Agent to ask, or a list that could not be read; neither holds the chat. */
export type PortingSkillStatus = "checking" | "present" | "missing" | "installing" | "unknown";

/**
 * What installing `plugin` on an Agent with `installs` rewrites: every Skill of it the Agent
 * carries, whatever its version (the copy is replaced whole, local edits included), and the
 * other parts the Plugins page's update names.
 */
export function rewrittenParts(plugin: PluginItem, installs: AgentInstalls): ChangedPart[] {
  const skills = plugin.skills.flatMap((skill): ChangedPart[] => {
    const installed = installs.skills.get(skill.name);
    return installed === undefined
      ? []
      : [{ kind: "skill", name: skill.name, installed, library: skill.version }];
  });
  return [...skills, ...changedParts(plugin, installs).filter((part) => part.kind !== "skill")];
}

export function usePortingSkill(
  projectId: string,
  /** The Agent the chat goes to (this server's); null asks nothing. */
  agentId: string | null,
): {
  status: PortingSkillStatus;
  /** Why the last install did not bring the Skill; null otherwise. */
  installError: string | null;
  /** Whether the chat waits: the Skill is known to be missing, being installed, or being read. */
  holdsChat: boolean;
  /** While the Skill is missing: the parts the install would rewrite; null when unknown. */
  rewrites: ChangedPart[] | null;
  /** Installs the plugin on the Agent; whether the Skill is there afterwards. */
  install: () => Promise<boolean>;
} {
  const [status, setStatus] = useState<PortingSkillStatus>("unknown");
  const [installError, setInstallError] = useState<string | null>(null);
  const [rewrites, setRewrites] = useState<ChangedPart[] | null>(null);
  /** Bumped on every new question, so an answer to an old one lands nowhere. */
  const asked = useRef(0);

  useEffect(() => {
    const ask = ++asked.current;
    setInstallError(null);
    setRewrites(null);
    if (agentId === null) {
      setStatus("unknown");
      return;
    }
    setStatus("checking");
    // Both at once, so "missing" never shows before what its install would rewrite is known; a
    // library that cannot be read leaves that unknown, which the dialog confirms without a list.
    Promise.all([
      api.getAgentPlugins(projectId, agentId, null),
      api.getPluginLibrary(null).catch(() => null),
    ]).then(
      ([res, library]) => {
        if (asked.current !== ask) return;
        if (res.skills.some((s) => s.name === PORTING_SKILL)) {
          setStatus("present");
          return;
        }
        const plugin = library?.groups
          .flatMap((g) => g.plugins)
          .find((p) => p.name === PORTING_PLUGIN);
        // A library without the plugin rewrites nothing: the install is refused, and says why.
        setRewrites(
          library === null
            ? null
            : plugin === undefined
              ? []
              : rewrittenParts(plugin, installsOf(res)),
        );
        setStatus("missing");
      },
      () => {
        if (asked.current === ask) setStatus("unknown");
      },
    );
  }, [projectId, agentId]);

  const install = useCallback(async () => {
    if (agentId === null) return false;
    const ask = asked.current;
    setStatus("installing");
    setInstallError(null);
    try {
      const res = await api.installAgentPlugins(projectId, agentId, [PORTING_PLUGIN], null);
      if (asked.current !== ask) return false;
      const there = res.skills.some((s) => s.name === PORTING_SKILL);
      setStatus(there ? "present" : "missing");
      // Installed, yet still without the Skill: this server's library copy predates it.
      if (!there) setInstallError(S.agent.migrateSkillNotInPlugin);
      return there;
    } catch (e) {
      if (asked.current !== ask) return false;
      setStatus("missing");
      setInstallError(apiErrorText(e));
      return false;
    }
  }, [projectId, agentId]);

  return {
    status,
    installError,
    holdsChat: status === "checking" || status === "missing" || status === "installing",
    rewrites,
    install,
  };
}
