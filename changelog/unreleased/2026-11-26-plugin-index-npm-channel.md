# The plugin index reads npm channels again

- **Date:** 2026-11-26
- **Type:** fix
- **Scope:** `core`, `server`

[中文版](2026-11-26-plugin-index-npm-channel.zh.md)

The index format's Channels section says a channel's `url` is required unless `kind="npm"`, where it must be absent — the registry itself is the place. The document check in `packages/core/src/plugin/index-document.ts` required a `url` on every channel, so the published index's first row that lists an `npm` channel failed the whole document: the server answered the Plugins page with `has a malformed entry at index 3`, the source's plugins dropped off the list, and the page showed the "One plugin source could not be reached" banner for a document it had actually reached.

A channel's `url` is now optional. `kind` stays required, a `url` that is present must still be a string, and the install face decides what a well-formed row's channel is worth: an entry whose github channel names no address lists but installs nothing, with a fault sentence instead of a crash.
