# Unreleased

- [2026-08-06] Desktop app: penguin brand icons on every platform, task-completion system notifications (renderer-only, desktop sessions), explicit single-user mode (user/member management rejected with `desktop_single_user` and hidden), and a bundled `penguin` CLI on PATH (automatic on deb; menu-driven install elsewhere, no system Node needed). ([details](2026-08-06-desktop-app.md))

- [2026-08-06] Admin "use system HTTP proxy" switch: server-wide proxy control (default on, live toggle, loopback exemption), off-state proxy-env stripping for agent subprocesses, OS-proxy injection on desktop. ([details](2026-08-06-system-proxy-switch.md))

- [2026-08-06] Web App: directory browsing no longer compounds path segments under repeated clicks (listings bound to their own directory, sequenced picker requests, localized `dir_not_found`), saving Project new-chat defaults resets the new-conversation draft (typed text survives, open drafts reseed live), the avatar update dot gains a tooltip and reaches the collapsed rail, the model catalog opens with only DeepSeek expanded (search force-opens matching groups), and the auto-created session workspace is consistently named 临时工作区 / "temporary workspace" (penguin-sdk skill v19). ([details](2026-08-06-web-app.md))

- [2026-08-06] Landing homepage leads with the desktop app: platform-aware download CTA in the hero, closing CTA repointed, CLI one-liner install moved below the fold to the quick start; `/download` page unchanged. ([details](2026-08-06-landing-desktop-first.md))

- [2026-08-06] Models: Thinking Machines Lab's Inkling joins on OpenRouter and Fireworks AI, Fireworks AI gains DeepSeek V4 Flash 0731, and the OpenRouter + SiliconFlow GLM-5.1 gateway listings are delisted (Z.AI direct stays; existing Project configs unaffected); agenthub-models skill v11. ([details](2026-08-06-model-catalog-inkling-dsv4-flash-0731.md))

- [2026-08-06] Release tooling: repo versions realigned with the shipped 0.2.1, and the release workflow now refuses a tag push whose version does not match `package.json` (the drift that made every dev build nag about updates); the bump is documented as a release-prep step. ([details](2026-08-06-release-version-guard.md))
