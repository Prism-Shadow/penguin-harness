# A bare URL ends where the URL ends, not where the sentence does

- **Date:** 2026-08-24
- **Type:** fix
- **Scope:** `web`
- **PR:** [#437](https://github.com/Prism-Shadow/penguin-harness/pull/437)

[中文版](2026-08-24-autolink-ends-at-ascii.zh.md)

A URL typed into Chinese prose swallowed whatever followed it. `见 https://penguin.ooo，然后继续`
linked the comma and the rest of the clause along with the address, so the link 404ed and the
sentence lost its punctuation to link styling. Markdown surfaces in the Web App now end a bare URL
at its last ASCII character.

## Details

- GFM's autolink literal ends a bare URL at whitespace, then trims a short list of trailing ASCII
  punctuation. Neither rule sees CJK, so `，`, `。`, `（）` and plain Chinese text run up against
  the host were all inside the href. English was never affected — `see https://penguin.ooo, then`
  already ended correctly.
- The boundary is the last ASCII character, because a URL is ASCII by RFC 3986; a trailing
  non-ASCII run is handed back to the paragraph as text.
- Explicit `[文档](https://…)` links are untouched: the trim applies only to autolinks, where the
  link text is the URL itself.
- One shared plugin list now backs all five Markdown renderers — chat messages, both Trace event
  views, the benchmark case browser and the workspace file preview — so a URL ends in the same
  place on every surface.
- A URL carrying *unencoded* CJK in its path is trimmed at the last ASCII character. That form is
  invalid per the RFC; the same link percent-encoded is untouched.
