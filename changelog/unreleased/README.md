# Unreleased

Changes since v0.1.1. The version number is assigned at release, when this folder is renamed.

- [2026-07-22] Web App: Workspace HTML previews open on a separate origin with a signed token, so `localStorage`, cookies and third-party embeds work while Agent-generated pages still cannot reach the session cookie or the API. ([details](2026-07-22-web-app.md))
- [2026-07-24] Goal mode: state an objective with an optional token budget and the system loops Tasks on one Session — GOAL.yaml protocol, three-round blocked audit, budget wrap-up round — surfaced as the CLI's `/goal` and `run --goal`, a `goal` field on the tasks API, and the Web composer's new "+" menu. ([details](2026-07-24-goal-mode.md))
