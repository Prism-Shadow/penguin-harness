/**
 * Preset content for builtin Agents; the plugin library lives in @prismshadow/penguin-plugins
 * (the library files are read live when building the preset).
 *
 * - Every Project comes with two builtin Agents. `default_agent` (the General Agent, the
 *   default conversational Agent) has the library's preinstalled plugin set installed at
 *   initialization (plugins marked `preinstall: false` are excluded and stay manual-install).
 *   `media_agent` (the Media Agent) runs every Activity image and alignment run, and its
 *   Vault holds the media providers' keys, speech's and sound's included: the server makes
 *   narrations, music and sound effects itself, with no Session, reading the keys from that
 *   Vault; it installs no plugins, and its
 *   AGENTS.md states that role.
 *   `activity_agent` (the Activity Agent) is what the Activities stages default to: it installs
 *   the WAF authoring plugin, which is `preinstall: false` so no other Agent carries it, and
 *   its AGENTS.md holds the rules every stage run shares. A module run still stages the skills
 *   it reads into its workspace, because a coding agent never sees an Agent's installed Skills.
 *   Other dedicated capabilities (creating an Agent, optimizing an Agent, etc.)
 *   are carried by Skills rather than dedicated builtin Agents.
 * - The preset carries no AGENTS.md: the default AGENTS.md is empty, with delegation and task
 *   conventions living in the default template's Suggested Workflows section.
 * - Skill metadata is auto-injected into the system Prompt via the `{{SKILL_METADATA}}`
 *   placeholder; it's not registered in AGENTS.md.
 */
import { libraryPlugin, loadPreinstalledPlugins, type LibraryPlugin } from "../plugins/index.js";
import { ACTIVITY_AGENT_ID, DEFAULT_AGENT_ID, MEDIA_AGENT_ID } from "./paths.js";

/** The set of Project builtin Agent ids (supplied along with the Project, cannot be deleted from Web). */
export const BUILTIN_AGENT_IDS: readonly string[] = [
  DEFAULT_AGENT_ID,
  MEDIA_AGENT_ID,
  ACTIVITY_AGENT_ID,
];

/** Agent initialization preset (only takes effect at initialization; ignored when loading an existing Agent). */
export interface AgentPreset {
  /** Display name written to system_config.yaml. */
  name?: string;
  /** Description written to system_config.yaml. */
  description?: string;
  /** Overrides the default AGENTS.md content. */
  agentsMd?: string;
  /** Plugins installed at initialization (installs none by default): their skills and hook packages. */
  plugins?: LibraryPlugin[];
}

/**
 * media_agent's AGENTS.md: its role in an Activity media run. Each run's own first message says
 * which helper to run and with what; this is what holds across all of them.
 */
export const MEDIA_AGENT_MD = `# Media Agent

You make one media file per Session for an Activity: an image. Narrations, word recordings, music and sound effects are made by the server itself, with the keys in your Vault; no Session of yours makes them.

- The Session's first message names the helper script in the workspace and its input file. Run that helper once, as the message says. Install its dependencies first when the message asks.
- The prompt, script, voice, provider, model and style in the input file were chosen by the author and the server. Never edit them, write your own, or swap in another provider, model or voice.
- When the helper fails, report its message and stop. Do not retry a paid request, try another provider, or make the media some other way.
- Your Vault holds the providers' keys. The helper reads them from the environment. Never print, echo or repeat a key's value.
- Never accept or move a candidate. The author listens or looks first, then accepts it in Activities.
`;

/**
 * activity_agent's AGENTS.md: what holds across every Activity stage it runs. Each run's own
 * first message says what to make, from which files, and where to write the result.
 */
export const ACTIVITY_AGENT_MD = `# Activity Agent

You author WAF learning activities for children aged 3 to 8, one stage per Session: a specification, a media list, an assessment, a module, or its acceptance tests.

- The Session's first message names the stage, its input files and the result file to write. Follow it. Where it and this file disagree, the message wins.
- The WAF authoring Skills are installed. When a run stages skills into its workspace, read those, in the order it lists them; they match the module being built.
- Work only in the Session workspace. The shared WAF checkout named in waf-context.json is read-only: never edit, commit or push it, or any shared module.
- Media is made by the Media Agent and accepted by the author. Use the media the run gives you. When something is missing, report it; never invent a file or claim it exists.
- When the data cannot support a capability, say so plainly instead of faking it.
- Never publish, deploy or delegate, and never contact production student or telemetry services.
- Finish only after writing the result file the message names. If you cannot, explain why and write nothing.
`;

/**
 * The preset list for a Project's builtin Agents (each initialized in turn when the Project is
 * created; an existing Agent is never overwritten). default_agent installs the library's
 * preinstalled plugins and has no preset AGENTS.md; media_agent installs none and gets
 * MEDIA_AGENT_MD; activity_agent installs the WAF authoring plugin and gets ACTIVITY_AGENT_MD.
 */
export function builtinProjectAgentPresets(): Array<{ agentId: string; preset: AgentPreset }> {
  return [
    {
      agentId: DEFAULT_AGENT_ID,
      preset: {
        name: "General Agent",
        description: "General-purpose agent that completes the user's requests with its tools.",
        plugins: loadPreinstalledPlugins(),
      },
    },
    {
      agentId: MEDIA_AGENT_ID,
      preset: {
        name: "Media Agent",
        description:
          "Generates speech, sound and images for activities. Keep the media providers' keys in its Vault.",
        agentsMd: MEDIA_AGENT_MD,
      },
    },
    {
      agentId: ACTIVITY_AGENT_ID,
      preset: {
        name: "Activity Agent",
        description:
          "Writes activity specifications, assessments, modules and tests, with the WAF authoring Skills installed.",
        agentsMd: ACTIVITY_AGENT_MD,
        plugins: [libraryPlugin("waf-authoring")].filter((plugin) => plugin !== undefined),
      },
    },
  ];
}
