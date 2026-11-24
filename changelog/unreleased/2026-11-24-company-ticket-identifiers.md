# Company tickets get a ticket- prefix

- **Date:** 2026-11-24
- **Type:** change
- **Scope:** Company mode, CLI, Web App

[中文版](2026-11-24-company-ticket-identifiers.zh.md)

New tickets use IDs such as `ticket-2026-11-24-launch-the-site`. The board, CLI and API use the same ID. Its date is the filing day in the organization's timezone, and filing another ticket with the same slug on that day adds a letter suffix such as `-b`.

Opening or refreshing a ticket bookmark opens its detail dialog. See [existing company tickets](2026-11-24-backward-compatibility.md#existing-company-tickets) for earlier IDs.
