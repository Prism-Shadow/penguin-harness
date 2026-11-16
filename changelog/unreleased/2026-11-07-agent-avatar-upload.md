# An Agent can have a picture of its own, changed like a person's avatar

- **Date:** 2026-11-07
- **Type:** feature
- **Scope:** `server`, `web`, `ui`, `ui-gallery`
- **PR:** [#1506](https://github.com/Prism-Shadow/penguin-harness/pull/1506)

[中文版](2026-11-07-agent-avatar-upload.zh.md)

An Agent can be given a picture of its own on its settings page. The page's header now leads with the Agent's avatar, and the Overview tab gains an Avatar field above the name: the avatar's preview, then the two controls a person's profile row has, in the same order. Change avatar opens the same crop dialog and saves on confirm, and Restore default asks first, since it deletes the picture. The picture saves on its own, so the tab's Save and Reset still answer only for the name and the description. Wherever the Agent is drawn, its picture now shows in place of the default penguin.

## Details

- The picture is a file in the Agent State, `agent_state/avatar.<png|jpg|webp>`, at most one per Agent. Saving a new picture removes the one in any other format. Because it is part of the Agent State, it is carried by a snapshot and its restore, by an export and the Agent created from it, and a machine's Agent keeps its picture on that machine. The Agent may also write the file itself.
- New routes: `GET /api/projects/:projectId/agents/:agentId/avatar` serves the picture, cached for good under the `?rev=` the Agent list carries as `avatarRev`. `PUT` with `{ avatar: dataUrl | null }` sets or removes it, for any member of the Project, and answers with the new `avatarRev`.
- Accounts, employees and Agents follow one avatar rule: png, jpeg or webp, at most 131072 characters as a data URL. A file is also checked against the format it claims, and a file larger than 256 KiB that was dropped in by hand is ignored. Employees and Agents share one implementation of that rule on the server.
- A picture keeps the Agent's rounded-square tile rather than an account's circle, and draws the default penguin if it fails to load.
- Which picture is drawn: in company mode, an employee's picture from its organization comes first, then the Agent's own, then the default. Everywhere else, the Agent's own picture is drawn, or the default when there is none. The Agents list, the sidebar's rows and Agent groups, subagent chips, the subagent panel and its topology, the Agent pickers, the plugin market's install rows, the Benchmark pages and the company channels' member stack all show it. Only the settings page's Overview tab changes it.
- The profile row, the employee dialog and the Agent page now use one shared picker for choosing, cropping and saving an avatar. Restore default asks first in all three, since it deletes the picture; the employee dialog used to act at once.
- The gallery's Avatars board shows an Agent's picture at 16, 24 and 48 px, beside one that fails to load.
