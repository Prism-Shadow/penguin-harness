/**
 * Preset content for builtin Agents; Skill documentation lives in @prismshadow/penguin-skills
 * (the library files are read live when building the preset).
 *
 * - Every Project comes with a single builtin Agent: `default_agent` (the General Agent, the
 *   default conversational Agent), which has every Skill in the library installed at
 *   initialization. Dedicated capabilities (creating an Agent, optimizing an Agent, etc.)
 *   are carried by Skills rather than dedicated builtin Agents.
 * - The preset carries no AGENTS.md: the default AGENTS.md is empty, with delegation and task
 *   conventions living in the default template's Suggested Workflows section.
 * - Skill metadata is auto-injected into the system Prompt via the `{{SKILL_METADATA}}`
 *   placeholder; it's not registered in AGENTS.md.
 */
import { loadLibrarySkills, type LibrarySkill } from "@prismshadow/penguin-skills";
import { DEFAULT_AGENT_ID } from "./paths.js";

/** The set of Project builtin Agent ids (supplied along with the Project, cannot be deleted from Web). */
export const BUILTIN_AGENT_IDS: readonly string[] = [DEFAULT_AGENT_ID];

/** Agent initialization preset (only takes effect at initialization; ignored when loading an existing Agent). */
export interface AgentPreset {
  /** Display name written to system_config.yaml. */
  name?: string;
  /** Description written to system_config.yaml. */
  description?: string;
  /** Overrides the default AGENTS.md content. */
  agentsMd?: string;
  /** Skills installed at initialization (installs none by default). */
  skills?: LibrarySkill[];
}

/**
 * The preset list for a Project's builtin Agents (each initialized in turn when the Project is
 * created; an existing Agent is never overwritten). The only builtin Agent is default_agent:
 * installs every Skill in the library, with no preset AGENTS.md.
 */
export function builtinProjectAgentPresets(): Array<{ agentId: string; preset: AgentPreset }> {
  return [
    {
      agentId: DEFAULT_AGENT_ID,
      preset: {
        name: "General Agent",
        description: "General-purpose agent that completes the user's requests with its tools.",
        skills: loadLibrarySkills(),
      },
    },
  ];
}
