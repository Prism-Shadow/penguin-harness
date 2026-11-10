/**
 * The plugin library vocabulary a plugin compiles against — types only.
 *
 * A plugin declares what it carries for an Agent as contributions of its own module, to the
 * five data-only slots of the server's `PluginLibraryModule`:
 *
 *   @Component({
 *     contributes: {
 *       "PluginLibraryModule.cards": [{ id: "goal.card", title: "Goal Mode", category: "office-productivity" }],
 *       "PluginLibraryModule.hooks": [{ id: "goal.hooks", version: "2026.10.26.1", path: "hooks", stop: [{ command: "stop.mjs" }] }],
 *     },
 *   })
 *   export class GoalPlugin {}
 *   export default { modules: [GoalPlugin] } satisfies Plugin;
 *
 * The package's build (`gen-ifaces`) writes that literal into its `ifaces.json`, and the library
 * reads it from there without running the package: a plugin that carries only content has no
 * code, no bundle and no entry. Content stays in files: a contribution names a directory inside
 * the package, and the library reads the files there. What `package.json` keeps is npm's own
 * fields.
 *
 * Every entry carries a tree-unique `id`, prefixed with the plugin name (`goal.card`,
 * `agent-development.skill.penguin-config`). Display fields are camelCase; the three hook points
 * keep the spelling `hooks.json` uses (`stop`, `pre_tool_use`, `user_prompt`).
 *
 * Nothing here emits runtime code: a plugin carries no runtime dependency on core for these.
 * Docs: packages/docs/content/skills.{zh,en}.md § "Plugin file format".
 */

/** A plugin's quick start: the demo a person runs to see what it does — a prompt the Plugins page pre-fills into a new-chat draft, never sends. */
export interface QuickStart {
  prompt: string;
  promptZh?: string;
  /** Skills of this plugin to pre-select in the draft. */
  skills?: string[];
  /** Open the draft in goal mode (the prompt is the objective). */
  goal?: boolean;
}

/**
 * `PluginLibraryModule.cards` — at most one per package, every field optional: how the plugin
 * appears on the Plugins page and the landing site. A missing field stays missing: the UI says so
 * (the plugin name for a title, a placeholder description, the puzzle glyph, the Other group).
 */
export interface PluginCard {
  /** Display name; absent → the plugin name. */
  title?: string;
  titleZh?: string;
  /** Chinese description (the English one is npm's `description`). */
  descriptionZh?: string;
  /** The card's one-line descriptions; absent → the full description. */
  shortDescription?: string;
  shortDescriptionZh?: string;
  /** A category id (see PLUGIN_CATEGORIES); absent or unknown → the Other group. */
  category?: string;
  /** Path of an image inside the package (SVG, PNG, JPEG, WebP, GIF or AVIF, at most 256 KB); absent → `icon.<ext>` at the package root when there is one. */
  icon?: string;
  /** Whether default_agent gets the plugin at creation; absent = true for a shipped plugin, always false for one an operator installed. */
  preinstall?: boolean;
  quickStart?: QuickStart;
  /** Links to the paper or the upstream implementation, which the landing site lists. */
  references?: string[];
}

/** `PluginLibraryModule.skills` — one Skill: the directory holding its SKILL.md, named by the directory's own name. */
export interface SkillContribution {
  /** The Skill's name: the basename of `path`, letters, digits, `_` and `-`. */
  name: string;
  /** The Skill's directory inside the package, e.g. `skills/a2ui`. */
  path: string;
}

/**
 * When a `user_prompt` command runs: `prompt` on every Prompt the user submits, `host` only
 * when the host starts the package's flow by name (`Session.runUserPromptHook` — goal mode's
 * start). Meaningless at the other hook points.
 */
export type UserPromptTrigger = "prompt" | "host";

/** One hook script entry: `command` is a path relative to the hook package's directory, run with Node; `timeout` in seconds (core's default applies when absent); `trigger` says when a `user_prompt` command runs (see userPromptTrigger for the default). */
export interface HookCommand {
  command: string;
  timeout?: number;
  trigger?: UserPromptTrigger;
}

/** `PluginLibraryModule.hooks` — at most one per package, installed into `agent_state/hooks/<plugin>/` with a `hooks.json` generated from it. */
export interface HookPackageContribution {
  /** `YYYY.MM.DD.N`: what an installed hooks.json is compared against. */
  version: string;
  /** The scripts' directory inside the package, e.g. `hooks`; every command stays inside it. */
  path: string;
  stop?: HookCommand[];
  pre_tool_use?: HookCommand[];
  user_prompt?: HookCommand[];
}

/** One vault key a plugin's MCP server needs before it can connect. */
export interface PluginSetupKey {
  /** The vault key, referenced as `${KEY}` in the server's config. */
  key: string;
  label?: string;
  labelZh?: string;
  /** Where to get the value (a URL), or one sentence. */
  help?: string;
}

/**
 * `PluginLibraryModule.mcpServers` — one MCP server, the `tools.mcpServers` entry an install
 * writes: its `${KEY}` references name vault values, `${PLUGIN_ROOT}` the package directory.
 */
export interface McpServerContribution {
  /** Unique in the package. */
  name: string;
  /** Exactly the `config` of a system_config.yaml entry. */
  config: Record<string, unknown>;
  /** The vault keys the user supplies; a key the config references and this list omits must be supplied too. */
  setup?: PluginSetupKey[];
}

/** `PluginLibraryModule.workbenches` — one Workbench app: its source directory, whose own package.json (`penguin.version`, `penguin.modules`) is the app's manifest. */
export interface WorkbenchContribution {
  /** The app's id: the basename of `path`. */
  name: string;
  /** The app's source directory inside the package, e.g. `workbenches/support`. */
  path: string;
}
