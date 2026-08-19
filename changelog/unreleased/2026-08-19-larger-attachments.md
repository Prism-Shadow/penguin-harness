# Larger attachments, with the upload limits in the admin's hands

- **Date:** 2026-08-19
- **Type:** feature
- **Scope:** `server`, `web`, `docs`
- **Issue:** [#345](https://github.com/Prism-Shadow/penguin-harness/issues/345)

[中文版](2026-08-19-larger-attachments.zh.md)

The composer's file attachments were capped at 10MB per file and 12MB per message. The default is now **100MB per file and 120MB per message**, and an admin can change both from the user menu without touching a config file or restarting anything.

## The whole chain moves together, or not at all

The 10MB figure was written down in four independent places — the composer's pre-flight check, the server's per-file cap, and the text of both locales' rejection message — with nothing keeping them in step. Raising one of those numbers on its own is worse than leaving it alone: a client that allows more than the server does replaces a clear "too large" refusal with an upload that runs to completion and then dies on a generic error.

So the number now has one home. The server owns it, `GET /api/me` reports it under `uploadLimits`, and the composer validates against what it was told — which is also the number its message quotes, so the toast cannot claim a limit that is no longer in force.

The **request body cap** is derived rather than fixed, for the same reason. A draft chat has no Session to upload to, so attachments ride the task request itself as base64 `data:` URLs, which inflates them by 4/3; a cap left at 20MB would have rejected a 100MB attachment at the HTTP layer, with a body-shaped error rather than a size-shaped one. It is now `base64(per-message total) + headroom for one inline image and the JSON framing` — about 190MB at the default, and smaller again the moment an admin lowers the limit, so a server whose caps were left low does not keep accepting 300MB bodies.

## Upload limits (admin, user menu)

A new **Upload limits** dialog sits beside Proxy options, built the same way: a form, written by one `PUT /api/admin/settings`, admin-only, with the server as the validating authority.

- **Max attachment size** and **Max total per message**, both whole MB, both bounded to **1–200MB**. An admin typing 100GB — 102400 in a MB field — is refused with the reason under the input, not obeyed. The ceiling is where the transport actually stops working: the body is buffered and JSON-parsed as one string, and V8 caps a string near 512MB.
- The total may not sit below the per-file cap, checked against the **effective** post-write pair — so raising only the per-file cap, or lowering only the total, is refused too rather than quietly producing a configuration in which a legal single attachment cannot be sent.
- Validation precedes every write, so one bad field leaves the others untouched, and the change applies to the next request with no restart: the validators and the body cap both read the setting per request.

Two numbers are deliberately not exposed. The per-message file **count** stays at 20 — it bounds how usable the chip row is, not what the server can survive, which is what the byte budgets are for.

## Inline images keep their own, much lower ceiling

An attachment is not multimodal input: it is written to the Session scratchpad and handed to the model as an `[attached file: <path>]` line, opened with ordinary file tools. Nothing downstream scales with its size, which is what makes 100MB reasonable in the first place.

An inline image is the opposite. It enters the conversation, is written verbatim into the Trace JSONL, and that file is read back whole — into a single JS string — on every history page and every Session resume. A large inline image is not a slow request, it is a Session that never recovers. Images had also never been size-checked at all: the only reason a 50MB paste failed was that the body cap happened to be small, and it failed *after* the tab had base64'd the file and uploaded it.

Images are therefore capped explicitly at **20MB** (413 `image_too_large`), client-side as well as server-side, and that cap does not follow the attachment limit up. It is above what the old body cap effectively allowed, so no paste that worked before stops working. Note this is the transport ceiling, not a promise the model will take the image: providers commonly cap around 5MB, and the `read_image` tool at 5MB, so an image between those numbers and this one uploads fine and may still be refused by the model.
