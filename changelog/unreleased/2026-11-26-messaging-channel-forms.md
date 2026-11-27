# The messaging binding editor reads each channel's form from one registry

- **Date:** 2026-11-26
- **Type:** refactor
- **Scope:** `messaging`, `web`

[中文版](2026-11-26-messaging-channel-forms.zh.md)

The Web App's messaging binding editor stopped branching on the channel. Each channel's half of the form moved into its own module under `packages/web/src/features/messaging/channels/`, listed once in a typed registry, and the editor kept only the shell. The editor looks and behaves as it did: before/after screenshots of all four channels, in Chinese and English and with the FAQ folds open, match pixel for pixel. No HTTP request, stored data or browser storage changed.

## Details

- `channels/channel-form.ts` defines `MessagingChannelForm`, what a channel supplies: its sub-state (blank, loaded from a stored binding), validation into its PUT body, its test body, the dirty and testable checks, its account id and masked-secret field, its save and probe endpoints with the notices a probe produces, the focus target of the gated switch, its fields component, and its copy around the fields (Markdown help, the extra "final reply only" paragraph, the setup and "what binding does" notes, troubleshooting entries, tutorial link).
- `channels/feishu/`, `channels/telegram/`, `channels/qq/` and `channels/wechat/` each hold `form.ts` (pure logic), `fields.tsx` (credential fields, stored-secret row, scan block and the note under them) and `index.ts` (the assembled form). `telegramTestNotices` moved to `channels/telegram/test-notices.ts` and `FEISHU_DEFAULT_DOMAIN` to `channels/feishu/form.ts`; the shared field pieces moved to `channels/fields-kit.tsx`.
- `channels/registry.ts` lists the four forms, `satisfies Record<MessagingChannel, …>`, so a channel added to the wire vocabulary without a form fails typecheck. `channels/channel-ids.ts` holds `MESSAGING_CHANNELS`, the picker order, with the same completeness check.
- `messaging-binding-editor.tsx` keeps the shell (where the binding runs, channel picker, enable switch and status lines, the two probes, the gate hint, the holders note, the delivery rows, the FAQ frame), and `messaging-binding-form.ts` keeps its exported functions as dispatchers over the registry, with `MessagingFormState` and the result types derived from it. `accountIdOf` in `messaging-binding-location.ts` reads the channel's form too. None of the three names a channel any more.
- A binding whose channel this build has no form for is skipped when the editor loads, rather than read as a Telegram binding.
- The ui-gallery mock registers the per-channel PUT and test routes from `MESSAGING_CHANNELS`.
