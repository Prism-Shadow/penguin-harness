# Models, Project, messaging, company and the remaining dialogs follow the settings commit model

- **Date:** 2026-10-10
- **Type:** feature
- **Scope:** `web`
- **PR:** [#1031](https://github.com/Prism-Shadow/penguin-harness/pull/1031)

[中文版](2026-10-10-settings-interaction-rest.zh.md)

The settings commit model of the [Settings dialog](2026-10-10-settings-interaction.md) reached the rest of the Web App: the models page and its dialogs, the Project dialogs, messaging, company mode, the ssh host form, the manual Benchmark form, the chat's shortcuts and the built-in browser's homepage. Each form's Save (or Create, Add, Hire) is live only once something changed and nothing is wrong, a malformed value is said under its field as it is typed, and leaving a form with unsaved edits asks 「放弃未保存的修改？」 first — Esc, the ×, a press outside, Cancel, a tab or document switch, a route change. A record dialog does not close while its own write is in flight.

## Models

- **The model dialog:** its footer verb became 「保存」 on a saved model and 「添加」 on a new one, in place of 「确认」. The dialog stays open until the table write answers and closes only once it landed; a refused write leaves the dialog with the draft and the list as it was, where the list used to show the refused change as if saved.
- **Errors in the Details fold:** with Save held while a field is wrong, a wrong field inside the folded Details opens the fold, so the reason Save waits is on screen.
- **Promotions:** saving a price or identity change on a row with a running promotion asks first, since the save ends the promotion. The ordinary 「保存模型配置」 confirmation before every save was removed. Setting the default or the vision model, which writes the draft too, waits for a valid draft.
- **Group settings and Add group:** both dialogs hold their verb while nothing changed or the base URL or group name is not acceptable, saying why under the field. The group settings no longer toast 「当前没有需要保存的修改」.

## Project

- The settings dialog's tab rail and its close ask while a tab holds unsaved edits: the display name, the chat defaults, the rule list and a rule half typed in the rule editor.
- The command policy's master switch writes the moment it is flipped, sending the stored rules with the flag changed; rule edits beside it stay in the list until the list's Save.
- The create dialog waits for an id that keeps the rule, said under the field as it is typed.

## Messaging

- The conversation's messaging panel asks before its dock tab's × drops unsaved credentials, and a route change asks too. The session-row dialog asks through the app's one prompt instead of its own card. The two keep separate scopes, so edits in one never make the other ask.
- Save waits for an edit that can be sent; a malformed token or domain is said as it is typed.

## Company mode

- **Organization settings, hire, budget, reporting line, desk renewal, new channel, rename and purpose, new document, new ticket, calendar events, a ticket's sections, and blocking a ticket** gained the guard and the held verb. Pausing or resuming an organization still writes at once, and the fields being typed beside it keep their edits.
- **Confirmations before an ordinary save were removed:** hiring, a budget, reporting-line or thinking-level change, saving a calendar event and saving a ticket section write at once. Moving a ticket, deleting and the desk renewal keep their confirmations. The reporting-line hint now says the employee's subordinates move with it.
- **The finance page's budget editor** no longer saves when focus leaves the box: Enter or the check saves, Esc or the cross cancels, and an edited box asks before the page is left.
- **The handbook editor's** Save waits for an edit; Cancel, another document and New document ask through the app's one prompt, and so do a route change, an organization switch and a reload.

## The rest

- **ssh hosts, the manual Benchmark form and the built-in browser's homepage** hold their verb until it can write and ask before a close drops what was typed. A Benchmark whose added case was removed again is unchanged.
- **The chat's shortcut editor** waits for its write: a refused save leaves the dialog open with the typing, where it used to close and drop it.
- **Enter no longer submits a form of several fields:** the ssh host dialog, the new channel's id, the new ticket's title and the shortcut's title wait for the button. One-field forms keep Enter: a channel's name, a new handbook document, the Project's display name.

## Tooling

- `test/form-commit-guard.test.ts` lists these modules among its form modules; with every module converted, its pending lists were removed.
