# Pages opened in a new conversation's draft go with it to the machine it starts on

- **Date:** 2026-11-26
- **Type:** feature
- **Scope:** `browser-automation`

[中文版](2026-11-26-machine-draft-pages.zh.md)

Pages opened in the browser panel of a new conversation whose workspace is on a remote machine, before its first message, now move to the conversation once that first send creates it on the machine. They stay in the same Project partition, and the machine's agents can drive them right away. Before, such pages stayed with the draft.

- The hub's `POST /api/builtin-browser/tabs/session` accepts a Session it does not hold once a machine of the draft's Project vouches for it, and holds the moved pages for that machine's Session.
- The machine hears of the pages at once, without waiting for them to change.
