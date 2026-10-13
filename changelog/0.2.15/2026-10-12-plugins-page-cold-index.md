# The Plugins page no longer waits on an unreachable plugin index

- **Date:** 2026-10-12
- **Type:** fix
- **Scope:** `server`, `web`
- **PR:** [#1083](https://github.com/Prism-Shadow/penguin-harness/pull/1083)

[中文版](2026-10-12-plugins-page-cold-index.zh.md)

On a server that could not reach the published plugin index (GitHub, from many networks in mainland China), `GET /api/plugins/registry` answered only after every attempt to fetch the index had failed, on every read. Until then the Plugins page showed no Agent Sandbox section and said nothing about why. The listing now answers with the shipped entries at once, names the published index as still loading, and adds its entries when it arrives.

## Details

- A listing waits for a source that has not answered for at most `SOURCE_WAIT_MS`, then answers without it and names it in the response's new `pending` field. The fetch goes on behind the answer, and a later read takes its entries from the cache.
- A fetch that failed with nothing cached is the answer for `INDEX_RETRY_MS`: reads in that window report the source as unreachable at once instead of starting another fetch. A cached index past its TTL is served at once while the refresh runs behind it.
- While a source is pending, the Plugins page says "One plugin source is still loading" under its title and reads the registry again every few seconds until the source has answered or failed; a failure turns the note into the existing "could not be reached" one.
- The trust rules for a remote index did not change: it is validated whole and its icons are dropped, as before.
