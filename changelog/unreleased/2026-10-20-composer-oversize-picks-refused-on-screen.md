# An oversize pick in the composer is refused on screen, not silently

- **Date:** 2026-10-20
- **Type:** fix
- **Scope:** `web`

[中文版](2026-10-20-composer-oversize-picks-refused-on-screen.zh.md)

A file or an image picked into the conversation composer over the upload limits was refused before being read — the right call for the upload — but the only thing that said so was a toast that leaves on its own after a few seconds, in a region with no `role`. Anyone who looked late found an empty composer and no message anywhere, as if the pick had simply vanished; the Files panel, by contrast, keeps its oversize wording on screen. The composer now keeps the refusal on screen too: a danger notice with `role="alert"` in the column right above the input card, one sentence per refused file, each naming the file and the ceiling that refused it (`qa.bin 超过 100MB 上限，未添加。` / `qa.bin exceeds the 100MB limit and was not attached.`), in both interface languages.

## Details

- The two intakes — images against `imageMaxMb`, file attachments against `attachmentMaxMb`, both ceilings admin-settable and read from `/api/me` — raise the notice instead of a toast. A pick event (the image entry, the file entry, a paste, a drop) starts from an empty slate, so a refusal line can never outstay the pick it explains, and a drop that refuses an image and a file shows both sentences.
- The notice stays until the next pick, a successful send, or its own close cross; within-limit picks and their chips are unchanged.
- The new `AttachmentRejectionNotice` (`packages/web/src/features/chat/attachment-rejection-notice.tsx`) is layout-only; the words stay with the chat copy (`S.chat.attachmentTooLarge`), and `packages/web/test/attachment-rejection-notice.test.ts` pins the announcement, both languages and the batch order.
