# Render complete HTML files in the workspace preview

- **Date:** 2026-11-23
- **Type:** fix
- **Scope:** `web`

[中文版](2026-11-23-complete-html-file-preview.zh.md)

The Files panel loads the full HTML document for a sandboxed preview, including scripts and images after the first MiB. Large, self-contained Bento presentations can open from a workspace folder before a conversation starts. If the document download fails, the preview shows the error.
