# Settings commit the same way everywhere: a switch applies, a form saves, leaving asks

- **Date:** 2026-10-10
- **Type:** feature
- **Scope:** `web`, `ui`, `skills`

[中文版](2026-10-10-settings-interaction.zh.md)

The Web App gained one interaction model for settings, and the Settings dialog was brought onto it. A switch applies the moment it is flipped; typed text and tables apply only on Save; leaving a form with unsaved edits, by any route, first asks 「放弃未保存的修改？」 with 「放弃修改」 and 「继续编辑」. The other settings surfaces follow in their own entries.

## The shared guard

- The shared UI package gained an unsaved-changes registry with `useFormDraft`, `useUnsavedChanges`, `useGuardedClose` and `guardLeave`, and `UnsavedChangesHost`, the one prompt every leave asks through. While any form is dirty, the host also holds a `beforeunload` listener, so a reload or a closed tab asks in the browser's own words.
- The Web App's router moved to a data router, so a navigation can be held: sidebar links, links and redirects anywhere in the app, `?tab=` switches, and the browser's back and forward buttons all ask while a form is dirty.
- A form counts as changed only while what Save would send differs from what is stored: typing the stored value back makes it clean again, and a switch never makes it dirty.

## The Settings dialog

- **Leaving:** switching pages on the rail, and closing the dialog by Esc, the ×, or a press outside it, ask while a page holds unsaved edits. Switching the interface language, which rebuilds every page, asks too.
- **Proxy options:** the two switches write the moment they are flipped, one value per request, and put themselves back with a toast when the write fails. The address saves on its own Save, and is shown as the server stored it. While the address has unsaved edits, the switches are held with the hint 「先保存代理地址」.
- **Upload limits:** Save is live only while a limit changed and both are whole numbers; a box that is not is marked under it as it is typed.
- **Plugins:** a card's switch and its on/off fields write when flipped, each to its own entry; everything typed on the card waits for its Save. A card re-read from the server keeps what is being typed, and picking another machine asks first while a card has unsaved edits.
- **Save, Reset and Cancel:** Save is held while nothing changed or a value is not valid, so the 「当前没有需要保存的修改」 toast no longer appears on these pages. Page forms gained Reset (「重置」), which restores the stored values without asking.
- **Change password and the admin's add-user and reset-password dialogs:** Save or Create is live only once the fields are valid (a mismatch or an id that breaks the naming rule is named as it is typed), and closing with anything typed asks first.
- **Appearance:** the tray icon switch says why when its write fails, instead of reverting silently.
- **Company mode:** turning it off joined the guarded consequential actions.

## Tooling

- The frontend skill gained the rule and a checklist for new settings surfaces.
- `test/form-commit-guard.test.ts` parses the Web App's JSX: typed controls never commit from `onBlur` or a committing `onChange`, a form that offers Save registers with the guard, and every dialog of a listed form module closes through it.
- The Web App's test suite gained an opt-in live DOM (jsdom) for interaction scenarios.
