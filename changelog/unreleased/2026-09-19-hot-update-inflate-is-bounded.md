# The hot-update channel bounds what its payload inflates to

- **Date:** 2026-09-19
- **Type:** fix
- **Scope:** `hmr`
- **PR:** [#801](https://github.com/Prism-Shadow/penguin-harness/pull/801)

[中文版](2026-09-19-hot-update-inflate-is-bounded.zh.md)

`POST /api/hmr/upgrade` inflated its gzip body with no bound at all: a few hundred kilobytes on
the wire decided how many gigabytes the process allocated, and the request only failed once
`JSON.parse` met whatever had been materialized. `zlib.gunzipSync` now carries a
`maxOutputLength`.

## Details

- The bound is read from the platform rather than chosen: `buffer.constants.MAX_STRING_LENGTH`,
  around 512MB. Past it the payload cannot become the string `JSON.parse` needs, whatever size a
  push is allowed to be — so it refuses exactly the payloads that could never have worked, and
  nothing else. A real push is single-digit megabytes.
- Nothing limits how large a push may be. Without the inflate bound the process allocated until
  it died, never reaching the string that would have thrown.
