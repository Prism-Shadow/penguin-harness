/**
 * @penguinharness/example-music — the smallest plugin that teaches the web app to draw a kind of
 * Workspace file.
 *
 * It ships no browser code to the app: the rule is DATA on the server's `WebModule.fileRenderers`
 * slot (the server's http/routes/contributions.ts), which the app reads from GET /api/contributions.
 * When a reply links a Workspace file with one of these extensions, the app's own `audio` renderer
 * draws a player below the paragraph that holds the link; the link itself is left as it is.
 *
 * The Agent learns to make such a file and link it from this package's `skills/send-music/`,
 * which the module declares on the server's `PluginSkillsProvider.skills` slot: while the
 * package is enabled (a Project lists it), that skill is installable onto an Agent through the
 * plugin install route, by this package name — the same install the plugin library's skills
 * take. No Project listing it, nothing installable.
 */
import { Component } from "@prismshadow/penguin-core/plugin";
import type { Plugin } from "@prismshadow/penguin-core/plugin";

/** The plugin's one module: nothing to bind, only the rule and the skill it contributes. */
@Component({
  contributes: {
    "WebModule.fileRenderers": [
      {
        id: "example-music.audio",
        extensions: ["mp3", "wav", "ogg", "m4a"],
        renderer: { builtin: "audio" },
      },
    ],
    "PluginSkillsProvider.skills": [{ id: "example-music.send-music", path: "skills/send-music" }],
  },
})
export class MusicFiles {}

const plugin: Plugin = { modules: [MusicFiles] };
export default plugin;
