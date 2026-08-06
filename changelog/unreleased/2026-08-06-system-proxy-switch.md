# Admin "use system HTTP proxy" switch

The sidebar user menu gains an admin-only, server-global "Use system HTTP proxy" switch (default on, saved immediately, stored in a new `server_settings` table and served by `GET/PUT /api/admin/settings`), implementing the long-specced 出网与系统代理 design.

- On: the server honors `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` (both spellings). Node's built-in fetch ignores those variables, so the server now routes all of its own outbound traffic — LLM provider requests, the update check, image downloads — through an undici global dispatcher and fetch, installed once at the entry.
- Off: the server always connects directly, and the proxy variables (including `ALL_PROXY`; `NO_PROXY` kept) are stripped from agent command subprocesses via a new optional `stripProxyEnv` getter threaded through the SDK's `CreateAgentOptions` → `Environment` (absent = proxy allowed, so standalone SDK/CLI behavior is unchanged).
- Either way the effective `NO_PROXY` always includes `localhost,127.0.0.1,::1`, keeping loopback traffic — readiness probes, SSE, workspace previews — off any proxy.
- Toggling rebuilds the dispatcher for new connections immediately; no restart. The CLI-hosted server (`penguin web`) inherits the same coverage since it imports the server entry in-process.
- Desktop: the shell resolves the OS proxy at launch (Electron `resolveProxy`; PAC `PROXY`/`HTTPS` results, SOCKS deliberately skipped — undici speaks HTTP(S) proxies only) and injects it into the embedded server's environment without overriding explicitly configured values.
