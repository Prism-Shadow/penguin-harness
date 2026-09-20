# Company mode: an employee has a name and an avatar, and `@name` reaches it

- **Date:** 2026-09-20
- **Type:** feature
- **Scope:** `server`, `web`, `cli`, `plugins`
- **PR:** [#809](https://github.com/Prism-Shadow/penguin-harness/pull/809)

[中文版](2026-09-20-employee-name-avatar.zh.md)

An employee was called by its Agent's display name — which, for an Agent created as an employee, is usually just its id — and drawn as a letter tile. It now has a name and a picture of the organization's own, and either its id or its name works after `@`.

## Name

- `org_chart.yaml`: an employee entry takes an optional `name` — any script, spaces allowed, one line, no `@`, at most 64 characters. It is the organization's to give; an entry without one goes by the Agent's display name, then the id, as before.
- Names need not be unique as written. Every surface shows — and `@` accepts — a name that is one employee's alone as it is, and a shared one with the id noted: `小明 (acme_dev_a)`. A name that equals another employee's id, a member's user id or `all` is noted the same way, since `@` already means something else there. This is `OrgEmployeeItem.name`; `givenName` is the entry's own text, for editing.
- `POST …/employees` takes `name` (a new Agent's `name` stands in when it is omitted); `PATCH …/employees/:agentId` takes `name`, `null` or an empty string clearing it. CLI: `penguin org employee set <agent_id> --name <name>`.

## Mentions

- A channel message addresses an employee by id or by name: `@acme_dev_a` and `@小明` deliver to the same desk. Since a name may be in a script without spaces, a mention is matched against what can be named rather than cut out by a pattern: at an `@` that does not continue a word, the longest handle the text continues with wins (`@小明明` is not `@小明`), one ending in an ASCII word character must end the word there (`@ann` is not found in `@anna`), and one ending in anything else needs no space after it (`@小明你好`). `@agent:<id>` and `@user:<id>` stay the explicit forms; an id still comes before a name, and an employee before a member of the same id.
- The composer's panel keeps open while a name in any script is typed and a pick types the name; messages highlight a mention by name like one by id. The employee skill says that `@<name>` works and that structured fields keep ids, and the trigger block's `employee:` line carries the name. `agent-company` is `2026.09.20.1`.

## Avatar

- An image file of the organization: `avatars/<agent_id>.png|jpg|webp`, so it can be dropped in by hand and goes wherever the directory goes. `PUT …/employees/:agentId/avatar { avatar }` takes the same data URL a person's own avatar does (png, jpeg or webp, at most 131072 characters) and `null` removes it; `GET …/avatar` serves it, cached for good under the `?rev=` that `OrgEmployeeItem.avatarRev` supplies.
- A picked image is cropped by hand before it is stored — drag to place it under the frame, scroll or slide to zoom (up to 4×), and what the frame shows is what is kept. The same crop step now sits in a person's own avatar picker (Settings › Profile), which used to take the centre square without asking.
- Web: "Name and avatar" in an employee's chart menu opens one dialog for both, with the picker a person's own avatar uses. The chart, the desk list, channel messages and members, the finance table and principal chips show the picture; an employee without one keeps the letter tile. The hire dialog has the name as well.
- Faces are drawn at a chat product's sizes rather than the icon scale's: 22px in the sidebar's desk list and a channel's member lists (was 14), 24px on the collapsed rail (was 18), 36px leading a run of channel messages (was 28, with the sender's name a step larger beside it). A desk row says what the employee is after who it is — `小明 (CEO)` — the note in a muted tone, yielding first when the row runs out of room; an employee with no name of its own is known by what it does, so its title leads and the id is the note: `Developer (acme_dev_a)`.
- A mention chip in a channel says what the person does as well as who it is: `@小明 (CEO)`, the title a tone lighter. The message text itself is unchanged — only the name is typed and stored.
