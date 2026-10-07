# The WAF workspace prepares itself at startup

- **Date:** 2026-09-29
- **Type:** feat
- **Scope:** `server`, `web`, `activities`

When the server starts with a managed WAF workspace that is not ready, it starts preparing it in the background: it clones the framework, navigation bar, media and activity data, and installs their dependencies, as **Prepare** does. **Settings → WAF workspace** shows the progress. **Prepare** still runs it again, for instance after a failure.

- **Nothing happens for an existing checkout.** No preparation runs when a checkout folder or `WAF_ROOT_DIR` is named, since Penguin only reads that checkout.
- **Refusals now say which state the workspace is in.** While it is being prepared, anything that needs it is refused with 503 `waf_workspace_preparing`. Once a preparation has failed, the refusal is 409 `waf_workspace_not_ready` and names why. Assembly now uses these same refusals instead of 400 `waf_checkout_missing`.
- **It can be switched off.** `PENGUIN_WAF_AUTO_PREPARE=0` disables it; the e2e server sets this, and tests do the same through their ports.
