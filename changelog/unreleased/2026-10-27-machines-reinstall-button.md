# The Machine dialog keeps a Reinstall button, and Stop retrying frees its toolbar

- **Date:** 2026-10-27
- **Type:** feature
- **Scope:** `web`
- **PR:** [#1377](https://github.com/Prism-Shadow/penguin-harness/pull/1377)

[中文版](2026-10-27-machines-reinstall-button.zh.md)

The Machine dialog's toolbar gained Reinstall, shown for every installed remote machine just before Uninstall. It installs this server's version on the machine again whatever version it carries, then restarts its server and reconnects (`POST …/use` with `replaceProgram`), after a confirmation in the danger tone. It waits only while another action runs on the machine or when this server has no version to install. The failed job's Force install button was removed: where installing again may help, one muted line under Retry points at Reinstall instead.

## Details

- Stop server, Restart server and Uninstall are greyed as out of reach only while the server is still bringing the machine back, or waits for its password to be entered again. Once reconnecting has stopped — a person's Stop retrying, the attempts running out, or an ssh refusal — they can be pressed.
- The "Restart needed" hover and the message for a machine missing this server's build now name the Reinstall button.
- The confirmation's body text takes the muted tone token.
- A card whose Use waits says "Not connected" for a machine that is out of reach, not checked yet or on another build; "Server stopped" is kept for a server that is stopped.
- The dialog's English section heading reads "Reconnection", so it no longer says "Reconnecting" over a streak that has stopped.
