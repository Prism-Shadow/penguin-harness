# Unreleased

Changes since v0.1.1. The version number is assigned at release, when this folder is renamed.

- [2026-07-24] Web App: unified the form controls onto a shared Field/portal layer (now with required-field `*` markers), moved notifications to one rule (success/info → top toast, field errors inline with a red border; error prompts localized by code), added a confirm-before-overwrite dialog for skill updates (shows each agent's `v_old → v_new`), made the Cost Center show the full error message, and deduplicated the i18n copy (dead keys removed, shared `common` labels, lowercase "agent"); plus the earlier separate-origin Workspace HTML previews. ([details](2026-07-22-web-app.md))
