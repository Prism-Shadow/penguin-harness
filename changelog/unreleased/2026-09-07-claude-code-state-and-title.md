# The Claude Code surface reads the program's own state and title

- **Date:** 2026-09-07
- **Type:** improvement
- **Scope:** `core`, `server`, `plugins`

[中文版](2026-09-07-claude-code-state-and-title.zh.md)

## Running, as the program says it

The surface used to call output "running" and silence past a window "idle". That is a different question with a similar answer: a redraw is not work (a resize, a paste echoing), and a long tool call is not over the moment the spinner pauses.

It now reads Claude Code's own spinner line off the screen:

```
✻ Working… (3s · ↑ 1.2k tokens · esc to interrupt)   ← running
✻ Worked for 2s · done 1:31 AM                        ← idle
```

The glyph animates and the word is picked from a long list, so what is matched is the **shape** — a symbol, one word, an ellipsis — never a particular word. Only the last written rows are read, since a transcript above can say anything.

## The Session takes the title Claude Code gives it

Claude Code names its own conversation and writes that name into its transcript (`{"type":"ai-title","aiTitle":"…"}`), updating it as the work turns. The surface follows that file and reports each new title, so a Session stops being called by whatever its first prompt happened to say.

The transcript is **chosen on every poll** — the newest one for the Workspace — rather than pinned when the program starts: `/resume` inside the TUI moves it to another session, and a pinned file would name the one it began with.

A surface may now report `{ status, title }` where it used to report only the status; the older, bare form still works. A title is taken only while nobody better has named the Session: the floor remembers what it last wrote, so a program may improve on the first prompt's line, and a person's rename ends the matter.
