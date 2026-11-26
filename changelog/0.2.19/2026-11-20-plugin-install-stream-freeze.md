# Installing a plugin from the Plugins page no longer freezes the tab

- **Date:** 2026-11-20
- **Type:** fix
- **Scope:** `web`
- **PR:** [#1668](https://github.com/Prism-Shadow/penguin-harness/pull/1668)

[中文版](2026-11-20-plugin-install-stream-freeze.zh.md)

Clicking Install on a server module in the Plugins page froze the browser tab. The server sends
its first progress event at once, and the Web App's reader of that answer then spun forever: the
tab stopped responding while the install itself finished on the server. The reader now takes
each event of the answer in turn, so the button shows the install's progress and the toast says
how it ended.

## Details

- It affected every install from the Plugins page that reads the server's answer as a stream,
  for any plugin, since [#1457](https://github.com/Prism-Shadow/penguin-harness/pull/1457). Installing a plugin on an Agent was not affected.
- A page reloaded after the freeze showed the plugin as installed, because the server had done it.
