/**
 * The import dialog's migration check: the chat it opens asks the Project's default agent to use
 * the `agent-porting` Skill, which ships in the `skill-porting` library plugin. A default agent
 * initialized before that Skill existed does not carry it, and installing a plugin is the only
 * thing that brings a new Skill to an Agent — so the dialog asks the Agent's Skill list when the
 * migration section opens, and while the Skill is missing it says so, offers the install (which
 * also updates a copy of the plugin the Agent already has: installing again is the update), and
 * holds the chat until the Skill is there.
 *
 * A list that cannot be read holds nothing: the prompt itself tells the agent to stop when the
 * Skill is unavailable. A refused install keeps the Skill missing and says why, the server's
 * reason included; so does an install that landed without it (a library copy older than the
 * Skill). An answer for an Agent the dialog is no longer asking about lands nowhere.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import * as api from "../../api/endpoints";
import { apiErrorText } from "../../lib/api-error";
import { S } from "../../lib/strings";

/** The Skill the migration prompt names. */
export const PORTING_SKILL = "agent-porting";
/** The library plugin that ships it. */
export const PORTING_PLUGIN = "skill-porting";

/** `unknown`: no Agent to ask, or a list that could not be read; neither holds the chat. */
export type PortingSkillStatus = "checking" | "present" | "missing" | "installing" | "unknown";

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
  /** Installs the plugin on the Agent; whether the Skill is there afterwards. */
  install: () => Promise<boolean>;
} {
  const [status, setStatus] = useState<PortingSkillStatus>("unknown");
  const [installError, setInstallError] = useState<string | null>(null);
  /** Bumped on every new question, so an answer to an old one lands nowhere. */
  const asked = useRef(0);

  useEffect(() => {
    const ask = ++asked.current;
    setInstallError(null);
    if (agentId === null) {
      setStatus("unknown");
      return;
    }
    setStatus("checking");
    api.getAgentSkills(projectId, agentId, null).then(
      (res) => {
        if (asked.current !== ask) return;
        setStatus(res.skills.some((s) => s.name === PORTING_SKILL) ? "present" : "missing");
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
    install,
  };
}
