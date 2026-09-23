# Company channels get default recipients

- **Date:** 2026-09-23
- **Type:** feature
- **Scope:** `server`, `web`, `cli`
- **PR:** [#840](https://github.com/Prism-Shadow/penguin-harness/pull/840)

[中文版](2026-09-23-channel-default-recipients.zh.md)

A company-mode channel can now name default recipients: members that a message with no `@` at all counts as mentioning. An employee on the list gets the line at its desk session, exactly as an `@` would deliver it; a person on the list sees the line counted under "@me" and listed in the overview inbox. A message that names anyone goes to the named alone, and `system` lines never use the list.

## Channel file

- `channel.toml` takes an optional `notify` list of `agent:<id>` / `user:<id>` principals; absent or empty, a message with no `@` is only recorded, as before.
- Entries must be members of the channel (every employee and every Project member is in the all-hands channel). Removing a member removes it from the list; an entry that has since left the organization is skipped at delivery.

## API, CLI and Web

- `PATCH /api/projects/:projectId/organizations/:orgId/channels/:channelId` takes `notify` (any member; `[]` clears; a non-member refuses the request with `notify_not_member`), and channel items carry `notify`.
- `penguin org channel notify <channel_id> <principal>...` sets the list, `--none` clears it; `penguin org channel show` prints it.
- The channel header's member list carries an **Always notify** toggle on every row (any member of a live channel may flip it); the header's "?" names the current recipients.
- The organization handbook explains the list to employees.
