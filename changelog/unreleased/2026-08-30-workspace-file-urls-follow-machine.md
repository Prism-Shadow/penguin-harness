# A Workspace file's address follows the Session to its machine

- **Date:** 2026-08-30
- **Type:** fix
- **Scope:** `web`
- **PR:** [#554](https://github.com/Prism-Shadow/penguin-harness/pull/554)

[中文版](2026-08-30-workspace-file-urls-follow-machine.zh.md)

Previewing a file in a Session that runs on a machine answered "Preview not supported for this type; download instead", whatever the type was — and images, PDFs and downloads failed the same way, as did images attached to messages. The files were there; the app was asking the wrong server for them.

## Details

- A call about a Session is routed to the machine that Session lives on by a rule over the request path, applied by the fetch wrapper. Three addresses never pass through it, because they are URLs rather than calls: the Workspace file content URL (used directly in `fetch`, `<img>`, `<iframe>` and the download link) and a message attachment's scratchpad URL. Both now apply the same rule themselves.
- The workspace browser reports a file it cannot read as a type it cannot render, which is why the failure surfaced as "preview not supported" rather than as an error.

## Known gap

"Open in new tab" for an isolated HTML preview still does not work for a Session on a machine: it is a redirect to a preview origin, and the proxy that carries a machine's calls deliberately drops `Location` headers. The rendered preview inside the app is unaffected.
