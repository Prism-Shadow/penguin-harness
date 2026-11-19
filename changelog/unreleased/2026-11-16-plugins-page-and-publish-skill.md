# The docs site carries a Plugins page, and the penguin-plugin skill covers testing, sharing and submitting a plugin

- **Date:** 2026-11-16
- **Type:** process
- **Scope:** `docs`, `skills`

[中文版](2026-11-16-plugins-page-and-publish-skill.zh.md)

The answers to "what is a plugin, how is one checked, where do plugins come from, how do I share one" lived in four places: the field tables deep inside Skills & Plugins, the submission protocol in another repository, and the collection rules and the testing method nowhere. A new **Plugins** page (`packages/docs/content/plugins.{en,zh}.md`, in the Guides group after Skills & Plugins) puts the four together: what a plugin is (a set of penguin modules — PRFC-0001 and PRFC-0003 carry the mechanism, the page links them), the package format and its two checks (the index CI's rules, with CONTRIBUTING as their authority, and a local build plus a load through the server's own path), the four sources of plugins (the harness's own modules being regrouped by the open module-regrouping pull request, the built-in `plugins/` tree, the third-party plugin index, and one's own or unlisted plugins installed from npm or linked with `penguin plugin link`), and sharing through those four ways.

The `agent-development` plugin's `penguin-plugin` skill — previously workbenches only — now carries the same ground for a harness session: a References section at the top (the Plugins page, Skills & Plugins, Server Boot, the index repository), how to test a package on a separate instance (`PENGUIN_HOME` pointed at a lasting path such as `.data/penguin-plugin` inside the plugin's repository, `penguin plugin link` into that instance's prefix), the four sources, and the sharing steps, which drive the index repository's CONTRIBUTING without restating it. The skills pages and `plugins/README.md` point back at the one skill; the agent-development row stays at six Skills.
