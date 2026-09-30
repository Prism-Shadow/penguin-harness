# The models page lines up with the model picker

- **Date:** 2026-09-30
- **Type:** feature
- **Scope:** `web`, `server`, `cli`, `model-catalog`, `docs`

[中文版](2026-09-30-models-page-refresh.zh.md)

The models page was reworked after the chat's model picker. A model is one line; a group's key is managed from its header; the three groups whose key comes from an authorization flow connect rather than "authorize a key"; the two vendors that publish an account balance show it; and a banner above the groups offers TokenDance's wallet.

## Rows

- Each model is one line in the picker's shape and spacing: the provider's logo, the display name and the shared tag pills right after it; on the right, the context window and the price billed today (left out on a narrow row), the speed-test figures, the lifetime Tokens, and the picker's crossed-out key on a row without one.
- The upstream id and the key status left the row for its tooltip. The crossed-out key moved into the shared icon set, so the picker and the page draw the same one.

## Group headers

- The actions stand in a fixed order, decided in one place (`groupHeaderActions`, `group-header.ts`): balance, **Connect** with its status, **Sync** (a connected Penguin Go), **Enter key**, the speed test, **Add model**, **Delete group**. A member sees the balance and the connection status and none of the rest.
- "Set key" became **Enter key** (填写密钥), a bordered button left of the speed test. It still writes one key to every row of the group, and custom still has none.
- The provider's key console link left the header. It stays in the **Enter key** dialog and in **Model settings**.
- The speed test is one icon that starts a run, after the same confirmation, and stops it. A stop lets the probe in flight finish and starts no other; results already measured stay.
- The model count is a bare number, as on the picker's rail.

## Connect

- TokenDance, Penguin Go and ModelScope's "Authorize key" became **Connect** (连接), with **Not connected** / **Connected** (未连接 / 连接成功) beside it. Connected means the group stores a key, whichever way it got there. Once connected, the button reads **Reconnect**. The flows themselves were not changed; the status flips when the dialog is closed and the table reloads.
- A banner above every group, for the owner while the TokenDance group has models and no key, offers TokenDance's connect flow. Its one slow highlight sweep every 6 s is CSS only and stands still under `prefers-reduced-motion`. **×** hides it in the browser (`penguin.tokenDanceBannerDismissed`).

## Balances

- `ModelProviderInfo.balance` declares a vendor's account-balance endpoint and the reader for its reply: TokenDance (`https://tokendance.space/portal/api/v1/user/balance`, `balance.balance` in micro-yuan) and DeepSeek (`https://api.deepseek.com/user/balance`, one entry per currency).
- `GET /api/projects/:projectId/models/balance?provider=<group>[&force=1]`, for any Project member, reads it with the group's stored key, which never leaves the server. It uses a 5 s limit and the outbound proxy settings, and caches for 60 s per Project and group for as long as the key is the same (`force=1` skips the cache). It answers `{ ok: true, provider, amount, currency, available?, others?, fetchedAt }`, or `{ ok: false, error, status?, message }` with `error` one of `unsupported`, `no_key` and `upstream_failed`; the vendor's own text is not relayed.
- The header shows the balance muted (`¥110.00`), reads it again on a click, and puts the read time in the tooltip; a balance that cannot be read is a muted "—" with the reason in the tooltip.
- A pin beside the balance, the session list's group pin, puts one balance beside the user name at the bottom of the sidebar and in the collapsed rail's avatar tooltip. It is stored per account in `ui_prefs.pinnedBalance`; pinning another replaces it. The pinned balance is read on page load and every five minutes after.

## Adding models

- Add model is offered on custom, vLLM and user-defined groups only (`ModelProviderInfo.addable`, `isAddableGroup`), and the model dialog's group list holds those groups plus the row's own. The server and `penguin config model add` refuse a new model that is no preset in any other built-in group (`400 model_not_addable`); rows already stored are kept. See [backward compatibility](2026-09-30-backward-compatibility.md).
- The "OpenRouter's popular models" example of **Create with AI** adds them as a group of the user's own.

## Docs

- The models, quickstart (desktop), configuration and CLI pages describe the new header, rows, **Connect**, **Enter key**, the speed-test toggle, account balances and the built-in-models-only rule, in both languages.
