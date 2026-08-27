# A mention that names no file is no longer announced in the chat

- **Date:** 2026-08-27
- **Type:** fix
- **Scope:** `server`
- **PR:** [#511](https://github.com/Prism-Shadow/penguin-harness/pull/511)

[中文版](2026-08-27-messaging-mention-no-file.zh.md)

The reply-file feature scans a reply's prose for path-like tokens and sends the ones that resolve
inside the Workspace. Names that resolved to nothing were announced in the chat — *"Named in the
reply but not sent — no such file inside this Session's Workspace: hello-world.md"* — on the
reasoning that a promised file which never arrives, with nothing to say why, reads as broken. That
notice was dropped, and the names were sent to the server log instead.

## Details

- The reasoning behind the notice holds only when something was promised. The rule reads prose, and
  prose names files for reasons that have nothing to do with delivery: a model describing a
  `hello-world.md` it went on not to write, or quoting a path out of a document it read. Announcing
  those put an error-shaped line under replies that were entirely correct, and left the reader no
  move to make.
- `messagingFilesMissingNotice` became `messagingFilesMissingLog`, and the name change is the
  point: a chat notice and a log line answer to different readers, and only one of them is charged
  for a name the reply merely mentioned.
- A file that exists and whose upload failed is still named in the chat. There the reply promised
  something that then did not arrive, which is the one case where silence reads as broken.
