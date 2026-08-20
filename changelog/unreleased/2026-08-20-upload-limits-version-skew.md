# A newer Web App no longer crashes on an older server's `/api/me`

- **Date:** 2026-08-20
- **Type:** fix
- **Scope:** `web`

[中文版](2026-08-20-upload-limits-version-skew.zh.md)

Opening Upload limits against a server that predates
[#350](https://github.com/Prism-Shadow/penguin-harness/pull/350) crashed the page with
`Cannot read properties of undefined (reading 'attachmentLimitMinMb')`.

The Web App and the runtime serving it are routinely different versions — that is what the
hot channel is for, and the desktop shell also attaches to whatever server is already
running. `/api/me`'s upload limits were assigned straight into state, so a payload from
before those fields existed replaced the built-in defaults with `undefined` wholesale, and
the first component to read a limit off them took the page down.

The payload is merged over the defaults now: a server's answer wins wherever it has one,
and anything it does not carry keeps the default. Only a display concern either way — the
server re-validates every upload against its own real limits regardless.
