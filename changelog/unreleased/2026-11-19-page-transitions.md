# Each theme plays its own page transition

- **Date:** 2026-11-19
- **Type:** feature
- **Scope:** `web`, `ui`
- **PR:** [#1610](https://github.com/Prism-Shadow/penguin-harness/pull/1610)

[中文版](2026-11-19-page-transitions.zh.md)

Moving to another page played the theme's page transition on the route body while the sidebar and frame stayed live. Frost blurred the outgoing page as the next one came into focus, Console dissolved the old page in small squares, Doodle gave the incoming page a small hop, and Primer switched at once.

## Details

- Only a change of page played it. Sending the first message of a new chat, switching conversations, opening a new chat and company mode's own sub-pages stayed still.
- Three motion tokens chose the transition: `--ui-page-duration`, `--ui-page-enter` and `--ui-page-exit`. Each theme's keyframes lived in its own pack, Console's pixel mask included; the shared sheet kept the transition plumbing and a neutral fade pair.
- Reduce Motion, from the system or the app, switched pages at once in every theme.
