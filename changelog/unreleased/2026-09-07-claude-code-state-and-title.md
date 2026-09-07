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

One transcript, one Session. Two surfaces can share a Workspace — the New chat page lets a person pick one — and then they share the directory Claude Code writes into; taking "the newest file" there made both Sessions read whichever program typed last and rename each other. A Session now claims the transcript its own program wrote (new, or grown since the surface opened — by **size**, since a filesystem's mtime comes from a clock too coarse to tell two appends apart) and keeps it. A `/resume` moves the program to another session and this does not follow it there: from the outside that is indistinguishable from the Session next door starting, and guessing wrong renames somebody else's. The title then stops updating until the surface is opened again.

A surface may now report `{ status, title }` where it used to report only the status; the older, bare form still works. A title is taken only while nobody better has named the Session: the floor remembers what it last wrote, so a program may improve on the first prompt's line, and a person's rename ends the matter.

## …and a push ships its own plugins, not the previous push's

Found while verifying the title on a machine: the corrected plugin arrived and the previous build's copy kept running. A hot upgrade materializes the new assets and publishes them **before** the new platform boots, but commits `harness.json` only **after** that boot succeeds — so a platform reading the committed pointer at boot reads the version it is replacing. Every push shipped plugins one version stale, and the fix appeared to work only on the push after it.

The platform now loads the plugins of the version it is booting with.
