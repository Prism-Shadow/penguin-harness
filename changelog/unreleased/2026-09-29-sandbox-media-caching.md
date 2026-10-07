# Preview media is cached while it is unchanged

- **Date:** 2026-09-29
- **Type:** feat
- **Scope:** `server`

An activity preview no longer downloads every picture and sound again on each request. Each
media URL in the payload now carries a `?v=` made from the file's own size and modification
time, as Loom's dev-sandbox does, rather than from the draft's revision. The media route
lets the browser keep a response for good when its `?v=` names the file on disk, and makes
it revalidate anything else, so a replaced file shows on the next request (the ETag turns an
unchanged one into a 304).

A per-file version is what makes the long cache safe: a file can change without the draft
changing, after a checkout pull or when LFS replaces a pointer with the real file.

Play links signed within the same hour are now the same link, because their expiry is
rounded up to the hour; a link still lasts at least twelve hours. The link is part of every
URL the player fetches, so without this each Reload would start from an empty cache.
