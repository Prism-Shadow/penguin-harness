# The SPA gets a caching contract, so a new build is actually visible

- **Date:** 2026-08-24
- **Type:** fix
- **Scope:** `server`

[中文版](2026-08-24-spa-caching.zh.md)

The built frontend was served with no caching headers at all, so what a browser did with it was
the browser's own business. A hot update could land, the server could be running the new build,
and a window could go on running the old one — with nothing on either side saying so.

Now the two kinds of file are served the way their names already promise:

- `index.html` is `no-cache` with an ETag. It is revalidated on every navigation and costs a 304
  when nothing changed, which is what makes a new build visible immediately.
- `assets/*` is `immutable`, cached for a year. Those filenames carry a content hash, so a
  changed file is a different URL and the old one can never be wrong.
