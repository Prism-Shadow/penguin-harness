/**
 * Preset content for builtin Agents; the plugin library lives in @prismshadow/penguin-plugins
 * (the library files are read live when building the preset).
 *
 * - Every Project comes with `default_agent` (the General Agent, the
 *   default conversational Agent), which has the library's preinstalled plugin set installed at
 *   initialization (plugins marked `preinstall: false` are excluded and stay manual-install).
 *   The default Project also includes penguin_support and its support workbench. Other capabilities (creating an Agent, optimizing an Agent, etc.)
 *   are carried by Skills rather than dedicated builtin Agents.
 * - The preset carries no AGENTS.md: the default AGENTS.md is empty, with delegation and task
 *   conventions living in the default template's Suggested Workflows section.
 * - Skill metadata is auto-injected into the system Prompt via the `{{SKILL_METADATA}}`
 *   placeholder; it's not registered in AGENTS.md.
 */
import { libraryPlugin, loadPreinstalledPlugins, type LibraryPlugin } from "../plugins/index.js";
import { DEFAULT_AGENT_ID, DEFAULT_PROJECT_ID } from "./paths.js";

export const SUPPORT_AGENT_ID = "penguin_support";

/** The set of Project builtin Agent ids (supplied along with the Project, cannot be deleted from Web). */
export const BUILTIN_AGENT_IDS: readonly string[] = [DEFAULT_AGENT_ID, SUPPORT_AGENT_ID];

/** Agent initialization preset (only takes effect at initialization; ignored when loading an existing Agent). */
export interface AgentPreset {
  /** Display name written to system_config.yaml. */
  name?: string;
  /** Description written to system_config.yaml. */
  description?: string;
  /** Overrides the default AGENTS.md content. */
  agentsMd?: string;
  /** Plugins installed at initialization (installs none by default): their Skills, hooks, MCP servers and workbenches. */
  plugins?: LibraryPlugin[];
}

/**
 * The preset list for a Project's builtin Agents (each initialized in turn when the Project is
 * created; an existing Agent is never overwritten). default_agent
 * installs the library's preinstalled plugins, with no preset AGENTS.md.
 */
export function builtinProjectAgentPresets(
  projectId = DEFAULT_PROJECT_ID,
): Array<{ agentId: string; preset: AgentPreset }> {
  const presets: Array<{ agentId: string; preset: AgentPreset }> = [
    {
      agentId: DEFAULT_AGENT_ID,
      preset: {
        name: "General Agent",
        description: "General-purpose agent that completes the user's requests with its tools.",
        plugins: loadPreinstalledPlugins(),
      },
    },
  ];
  if (projectId === DEFAULT_PROJECT_ID) {
    const support = libraryPlugin("penguin-support");
    if (!support)
      throw new Error("The built-in penguin-support plugin is missing from the library.");
    presets.push({
      agentId: SUPPORT_AGENT_ID,
      preset: {
        name: "PenguinHarness Support",
        description:
          "Product support with questions, follow-ups and answers grounded in the official docs and source code.",
        agentsMd: "Read and follow the penguin-support Skill for every support question.\n",
        plugins: [support],
      },
    });
  }
  return presets;
}
