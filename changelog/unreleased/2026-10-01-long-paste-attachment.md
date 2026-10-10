# A very long paste becomes a text-file attachment

- **Date:** 2026-10-01
- **Type:** fix
- **Scope:** `web`, `docs`

[中文版](2026-10-01-long-paste-attachment.zh.md)

Pasting a very long text into the composer — more than 20,000 characters or 400 lines, such as a
whole log — no longer puts it in the text box, where every later keystroke re-rendered it and the
page stopped responding. It is attached as a text file named `pasted-<date>-<time>.txt`, shown as
an attachment chip with a short notice, and sent like any attached file, so the model still reads
all of it. Goal mode takes no file attachments, so there the text is pasted as before.
