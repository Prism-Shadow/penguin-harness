# The frontend is compressed on the way out

- **Date:** 2026-08-24
- **Type:** performance
- **Scope:** `server`

[中文版](2026-08-24-static-compression.zh.md)

The built app was served uncompressed — over a megabyte of JavaScript on a first load, which is
the single largest thing that load waits on. It is now negotiated per request: brotli when the
client offers it, gzip otherwise, and the original bytes for anything that offers neither.

On the current bundle that is **1229 KB → 329 KB**.

Compressed bodies are cached against the ETag, which already identifies one exact
representation, so a file is compressed once per push rather than once per page load. The cache
is bounded and evicts oldest-first, since a hot push replaces every file in it.

## What is left alone

Anything already compressed (`png`, `woff2`, `ico`) and anything under 1 KB. Recompressing a PNG
spends time to send slightly more bytes, and a few hundred bytes rarely shrink past the gzip
header.

## Correctness notes

- `Accept-Encoding` is parsed rather than substring-matched: `gzip;q=0` is a **refusal**, and
  reading it as consent would return bytes the client cannot decode.
- `Vary: Accept-Encoding` is sent on every response that could have varied — including the 304,
  and including when this particular client took no encoding — so a shared cache cannot hand
  one client's brotli to another that cannot read it.
- The compressed form carries a **weak** ETag, as a re-encoding proxy would: it is a different
  representation of the same thing, which is exactly what a weak validator claims. Revalidation
  matches from either spelling.
