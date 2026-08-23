# One documented format for a Skill's `updated` frontmatter

- **Date:** 2026-08-23
- **Type:** process
- **Scope:** `docs`, `skills`, `server`

[中文版](2026-08-23-skill-updated-frontmatter-format.zh.md)

The Skills doc pages described `updated` as a date and showed `updated: 2026-07-17`, while every
Skill in the built-in library, the `skill-porting` and `agent-initialization` recipes for writing
one, and the library test's assertion all use an ISO 8601 UTC timestamp. The documentation and the
two DTO comments were moved onto the format the library actually ships.

## Details

- `skills.en.md` / `skills.zh.md`: the frontmatter table entry and the example both name an ISO 8601
  UTC timestamp, and the tolerant-parsing paragraph states that the value is stored as written and
  never parsed, with the library's convention alongside it.
- The field comments in `packages/skills/src/index.ts` and the `SkillMetadataItem` DTO in
  `packages/server/src/api/types.ts` say the same.
- Parsing is unchanged: `updated` remains an opaque string with an empty-string default, and the
  Web App keeps rendering it as a relative date.
