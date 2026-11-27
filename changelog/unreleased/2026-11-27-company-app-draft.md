# A design draft of company mode as an App Center app, in the gallery and on the landing site

- **Date:** 2026-11-27
- **Type:** feature
- **Scope:** `ui-gallery`, `landing`
- **PR:** [#1916](https://github.com/Prism-Shadow/penguin-harness/pull/1916)

[中文版](2026-11-27-company-app-draft.zh.md)

The component gallery gained a working draft of company mode rebuilt as an app the agent-company plugin contributes to the App Center, and the landing site gained a `/company` page that frames it live. The shipped `/org` pages and the server were not changed.

## Details

- The gallery's mock `/api/contributions` now returns one plugin page, `agent-company.app`, declared as an App Center app with an iframe renderer. It opens in the App Center window like any other app, and on its own at `/app/<project>/system_agent/company`.
- The app (`company.html`) runs entirely in the browser on demo data, in both languages, and follows the host's theme, language and location through the existing frame messages.
  - **Inbox:** what is waiting on the user, what is in progress, and what has settled.
  - **Tickets:** a board with columns for working, verifying, waiting on the user, and done. Each ticket opens in a drawer with its log folded.
  - **Team:** the lead, the executors and the verifier.
  - **Handbook:** rules and lessons, each lesson naming the Skill version it produced; a member's Skill rolls back from the Team page.
  - **New organization:** created from a goal or from a template.
- The inbox handles three kinds of item:
  - **Decision cards** use the A2UI `ChoiceBlock`, and the chosen answer is written into the ticket and the handbook.
  - **Deliveries** can be accepted, opened in the Agent workbench, or sent back with a reason. A send-back counts a round, records a lesson and moves the executor's Skill version.
  - **Halted tickets** stop at the send-back limit (the model also halts on budget), and show a breaker the user can lift.
- "Talk to the lead" and "Take it over" hand off to an ordinary conversation through `penguin:navigate`.
- Two gallery surfaces, `company` and `company-new`, open the app inside the framed Web App.
- The landing site's `/company` page (`/company/` in the static build) has four sections:
  - The live gallery frame, labelled as a design draft.
  - The four questions that set multi-agent products apart.
  - The platform seams the app uses.
  - The trade-offs: kept, changed, later and not doing.
