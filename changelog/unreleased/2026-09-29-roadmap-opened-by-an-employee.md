# An employee can open a roadmap

- **Date:** 2026-09-29
- **Type:** fix
- **Scope:** `plugins`
- **PR:** [Myriad-Dreamin/penguin-harness#103](https://github.com/Myriad-Dreamin/penguin-harness/pull/103)

[中文版](2026-09-29-roadmap-opened-by-an-employee.zh.md)

`POST …/roadmaps` no longer refuses an employee with `403 people_only`. A person who asks an employee to open a roadmap now gets one. The employee sends the same request a person's page sends, from its session, and the roadmap opens its room as before.

- The employee is recorded as the roadmap's opener and as the room's creator.
- The room holds the employees the request names. The opening employee is in it only when it names itself, which is how the organization gateway already treats an employee who opens a room.
- Over an existing channel, an employee faces the same check a person does: every employee named must already be in that channel.

Nothing else about the room changes: the room sessions, the relay, the desk lines and the claim on its mentions all work as before. A room opened by an employee has no person to speak to first, so its moderator is not told to start with one. The **Open a roadmap** button and the sidebar's **+** are unchanged, because they are a person's way in.
