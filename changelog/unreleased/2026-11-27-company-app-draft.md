# A design draft of company mode as an App Center app, in the gallery and on the landing site

- **Date:** 2026-11-27
- **Type:** feature
- **Scope:** `ui-gallery`, `landing`
- **PR:** [#1916](https://github.com/Prism-Shadow/penguin-harness/pull/1916)

[中文版](2026-11-27-company-app-draft.zh.md)

The component gallery gained a working draft of company mode rebuilt as an app the agent-company plugin contributes to the App Center, and the landing site gained a `/company` page that frames it live. In the draft, one conversation is one job. The shipped `/org` pages and the server were not changed.

## Details

- The gallery's mock `/api/contributions` now returns one plugin page, `agent-company.app`, declared as an App Center app with an iframe renderer. It opens in the App Center window like any other app, and on its own at `/app/<project>/system_agent/company`.
- The app (`company.html`) runs entirely in the browser on demo data, in both languages, and follows the host's theme, language and location through the existing frame messages.
- The app's page is one list of the organization's conversations, drawn with the sidebar's own conversation row:
  - **Groups:** waiting on you, in progress and done. A job waits on you when it, or any sub-session under it, has an action waiting for approval.
  - **Sub-sessions:** the conversations a member delegates are indented under their job.
  - **Opening a job** opens that conversation in the Web App through `penguin:navigate`. Each demo job is a conversation the gallery's mock store already holds, so the approval is answered on the real conversation page.
  - **The row menu** copies the session ID, and stops a running job together with its sub-sessions.
  - **New job** opens the Web App's new conversation.
- **New organization** starts from a goal or from a template, which names the members and when they open conversations on their own.
- Two gallery surfaces, `company` and `company-new`, open the app inside the framed Web App.
- The landing site's `/company` page (`/company/` in the static build) has four sections:
  - The live gallery frame, labelled as a design draft.
  - The four questions that set multi-agent products apart.
  - The platform seams the app uses.
  - The trade-offs: kept, changed, later and not doing.
