# Backward compatibility: `action_runs` without the `notify` origin, `roadmaps` without `moderator`

- **Date:** 2026-10-04
- **Type:** process
- **Scope:** `company-proposals`, `company-roadmaps`

[中文版](2026-10-04-backward-compatibility-notify-actions.zh.md)

[Desk deliveries became notify Actions](2026-10-03-proposal-roadmap-actions.md#notices), and a notice's run is recorded with `via = 'notify'`. An `action_runs` table created in `company.db` before that change checks `via` against `'web'`, `'cli'`, `'session'` and `'api'` only, so it cannot record a notice's run.

## The old shape: `action_runs` with the narrower CHECK

Chosen: **widen the table once, in place.** When the Action registry opens an organization's `company.db` and finds the old CHECK, it rebuilds `action_runs` in one write transaction: the rows are copied into a table with the current CHECK, which takes the old one's name, and its indexes and append-only triggers are created again. No row changes; a table that already has the CHECK is left alone.

**A user is not required to do anything.**

## The old shape: `roadmaps` without `moderator`

[`roadmap.members`](2026-10-03-proposal-roadmap-actions.md#roadmap-members) stores the moderator it names in `roadmaps.moderator`. A `roadmaps` table created in `company.db` before that change has no such column.

Chosen: **add the column once, in place.** When the roadmap plugin opens an organization's `company.db` and the table lacks the column, it adds it (`ALTER TABLE … ADD COLUMN moderator TEXT`) in one write transaction. Every existing row reads null, so its moderator is derived exactly as before. An older build ignores the column, so a rollback needs nothing undone.

**A user is not required to do anything.**

## When this can be removed

The rebuild (`widenRunVia` in `plugins/company-proposals/src/action-store.ts`) stays while a `company.db` written before 2026-10-04 may still be opened. No released build wrote `action_runs`, so it can be removed at the latest when the first release that includes the Action registry ships. The company-proposals plugin maintainers own the removal.

The column check (`addRoadmapModerator` in `plugins/company-roadmaps/src/schema.ts`) stays on the same terms: no released build wrote the `roadmaps` table, so it can be removed, leaving the column in the table's definition, at the latest when the first release that includes roadmap Actions ships. The company-roadmaps plugin maintainers own the removal.
