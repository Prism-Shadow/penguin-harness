# The hot-update channel has a size bound of its own

- **Date:** 2026-08-23
- **Type:** fix
- **Scope:** `server`
- **PR:** [#426](https://github.com/Prism-Shadow/penguin-harness/pull/426)

[中文版](2026-08-23-hot-update-has-its-own-size-bound.zh.md)

`POST /api/hmr/upgrade` inflated its gzip body with no bound at all: a few hundred kilobytes on
the wire decided how many gigabytes the process allocated, and the request only failed once
`JSON.parse` met whatever had been materialized. The upgrade channel now carries its own 256MB
bound, applied both to the compressed body and to what that body inflates to.

## Details

- The bound is where the transport stops working rather than a preference: the inflated payload
  becomes one string for `JSON.parse`, and V8 caps a string near 512MB. A real push is
  single-digit megabytes.
- Bounding the inflated size is what makes bounding the body meaningful, which is why the channel
  states its own number instead of riding the `/api/*` JSON cap — that cap has nothing to say
  about what a gzip stream expands to.
- The cap is checked before the channel's authentication, so an oversized body is cut off the
  stream rather than buffered while credentials are checked.
