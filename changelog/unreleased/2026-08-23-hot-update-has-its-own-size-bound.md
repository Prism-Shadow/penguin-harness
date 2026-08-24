# The hot-update channel has a size bound of its own

- **Date:** 2026-08-23
- **Type:** fix
- **Scope:** `server`

[中文版](2026-08-23-hot-update-has-its-own-size-bound.zh.md)

`POST /api/hmr/upgrade` sat behind the `/api/*` body cap, which is derived from the
admin-settable attachment budget. Lowering that budget therefore shrank the hot-update
channel with it: at the smallest budget an admin can set, a push over roughly 32MB came back
`payload_too_large`. How large one chat message's attachments may be has nothing to say about
a payload carrying a whole web dist and the platform's native assets — and the endpoint it
was shrinking is the one a broken installation gets repaired through, where a 413 locks the
operator out rather than inconveniencing them.

The upgrade channel now carries its own 256MB bound, applied both to the compressed body and
to what that body inflates to.

## Details

- The bound is where the transport stops working rather than a preference: the inflated
  payload becomes one string for `JSON.parse`, and V8 caps a string near 512MB. A real push
  is single-digit megabytes.
- Bounding the inflated size is what makes bounding the body meaningful — without it a few
  hundred kilobytes of gzip decided how many gigabytes the process allocated.
- The cap is checked before the channel's authentication, so an oversized body is cut off the
  stream rather than buffered while credentials are checked.
