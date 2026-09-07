# A host command carries its own words

- **Date:** 2026-09-07
- **Type:** improvement
- **Scope:** `desktop`, `server`, `web`

[中文版](2026-09-07-host-commands-carry-their-words.zh.md)

The command palette asks the host what it can do. Until now the answer was a list of ids, and the page looked each one up in a table it shipped with — so the only commands it could ever show were the ones it already carried. A host offering anything else got nothing for it, and an id the page had never heard of threw while the actions were built, which blanked the whole App.

The host now sends the words with the command: `GET /api/command` answers `offers`, each an id with a label in both languages, and the page renders what it is given. Neither the server nor the page checks an id against a list of its own; the only question either asks is whether the host offered it.

This matters because the three programs ship apart — the desktop shell reaches users through an installer, the server and the page through a hot push — so a shell newer than the page it serves is the ordinary case, not an edge one.

A command the page *does* know keeps the page's own words: they are translated properly and carry search terms, and they can be improved by a push instead of an installer. The host's words are the floor.

Older builds on either side keep working. A shell that sends bare ids is read as offers without words, which the page already has words for; a page older than `offers` reads the narrower `commands` field, which lists only the ids that page can safely look up.
