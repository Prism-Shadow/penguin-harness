# Backward compatibility: a remote machine reporting one recommended sandbox backend

- **Date:** 2026-10-03
- **Type:** feature
- **Scope:** `web`
- **PR:** [#978](https://github.com/Prism-Shadow/penguin-harness/pull/978)

[中文版](2026-10-03-backward-compatibility-sandbox-recommended.zh.md)

[The Sandbox card](2026-10-03-sandbox-landlock-floor.md) reads `backend.recommended` from the machine it shows as a list of packages. A server from before this change reports a single package as a bare string.

## The old shape: `recommended` as a string

When the card shows a remote machine running an older server, the Web App reads the string as a one-package list, and turning the switch on offers that package. Without this, the string would be split into its characters and each offered as a package. Only the Web App is affected; nothing is stored. **A user is not required to do anything.**

## When this can be removed

The fallback is `recommendedOf` in `packages/web/src/lib/sandbox-backend-prompt.ts`, marked `TODO(recommended-string-compat)`. It can be removed once every machine a Web App can show runs a server that reports the list form, that is, once releases before this change are no longer supported for remote machines.
