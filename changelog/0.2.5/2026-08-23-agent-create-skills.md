# Pick the Skills a new Agent starts with

- **Date:** 2026-08-23
- **Type:** feature
- **Scope:** `web`, `server`
- **PR:** [#431](https://github.com/Prism-Shadow/penguin-harness/pull/431)

[中文版](2026-08-23-agent-create-skills.zh.md)

The Agent create dialog gained a Skills field: a dropdown that takes several skills from the
library at once, and creating the Agent installs them into it.

## Details

- The field uses the form-variant picker trigger already shared by the schedule dialog's model and
  workspace pickers, over the same multi-select panel the chat composer's skills dropdown uses — a
  search box and one toggle row per library skill, the panel staying open as rows are toggled.
- That panel gained a bulk row, shown where a host asks for it: the running count of what is
  picked, plus **Select all** and **Select none**. Both act on the rows the search box currently
  leaves visible, so a filtered "select all" adds only the matches.
- `POST /api/projects/:p/agents` accepts a `skills` array of library skill names. The names are
  resolved against the library before the Agent directory exists — an unknown name answers 404
  `unknown_skill` and creates nothing — and are installed through the same writer the Skills tab's
  install uses, inside the same cleanup window as the rest of Agent initialization.
- Creating an Agent with nothing picked installs no skills, as before.

## Importing a checkout's own Skills

The same dialog can also install the Skills a project directory already carries, which a coding
agent leaves in `.agents/skills/` or `.claude/skills/`. Pick a directory and its Skills appear in
a picker of their own, with the same Select all / Select none row; nothing is installed that was
not picked.

- The directory field is its own field rather than more entries in the library picker, because a
  directory Skill may share a library Skill's name and still be the one installed — one flat list
  of picked names could not say which was meant.
- `.claude` is very often a symlink to `.agents`, which would otherwise offer every Skill twice:
  the two roots are resolved through `realpath` and a shared target is read once. Where both exist
  as real directories and carry the same name, `.agents` wins.
- A directory Skill installs over a library Skill of the same name picked alongside it: choosing a
  directory for this Agent is the narrower intent.
- A directory carrying nothing installable is a stated fact in the field, not an error, and what is
  passed over is passed over silently: a directory with no `SKILL.md`, one whose `SKILL.md` has no
  frontmatter, a name the installer would reject, a symlinked Skill directory, and a Skill whose
  files cannot be read or exceed the caps — one bad Skill does not hide the rest of the directory.
- Reading a picked directory reuses the archive import's caps and its walk discipline — 200 files,
  5MB per file, 20MB total — so the numbers live in one place for both entry points rather than
  two. Every file is read only after a stat says it is a regular file within the cap, `SKILL.md`
  and `icon.svg` included, so a symlink cannot hand back a file from outside the Skill directory,
  a FIFO cannot block the read, and an oversized file is refused before it is in memory.
- Listing a directory reads only what describes a Skill; the auxiliary files that make up the
  installable payload are read for the picked names alone.
- Both entry points admit a client-supplied path the same way — absolute, existing, a directory,
  resolved through `realpath` — through one helper the `dirs` browser now shares.
- The client sends names, never Skill content: creation re-reads the files from disk, and both
  sources resolve completely before anything is written, so a name that has since disappeared fails
  while the Agent still does not exist.

