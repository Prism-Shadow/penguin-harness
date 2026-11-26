# The plugin install chain can reach GitHub through the deployment's own mirrors

- **Date:** 2026-11-15
- **Type:** feature
- **Scope:** `server`
- **PR:** [#1563](https://github.com/Prism-Shadow/penguin-harness/pull/1563)

[中文版](2026-11-15-per-source-cdn.zh.md)

The two fetches of the plugin install chain — the index document (`index.json`) and the
release asset an index entry's channel installs through — each had exactly one address, both
on GitHub. A deployment that cannot reach it discovered no plugins and installed none. Both
fetches now carry fallbacks: the deployment can configure proxy rules (`PENGUIN_PLUGIN_PROXY`,
one JSON array) that rewrite a URL into the addresses a mirror serves the same bytes at, and
each fetch tries its addresses one at a time in configuration order — the source's own URL
first, then the rewritten ones — moving on at a connection failure, a timeout, a non-ok
answer or an answer that stops halfway, and reporting which addresses were tried when none
answered. Nothing picks a winner by speed, so the same deployment walks the same path until
an address actually fails.

The start of that order follows success: each fetch begins at the address that answered last
(the one whose document parsed, the one whose bytes verified), so a deployment whose canonical
address is dead does not pay its window on every fetch. This is memory, not a speed test — no
probe, no measuring; a start that has died hands the walk back to the configured order inside
the same fetch, and an address whose document or bytes are refused is never remembered.

A rule is Cloudflare-rewrite shaped: `kind` (`"rewrite"`), `match` (a JS regex over the whole
URL) and `rewrite` (the result, `$1`–`$9` naming the capture groups). Rules are compiled and
shape-checked when the config is parsed — a pattern whose worst case is not linear
(`safe-regex`, against catastrophic backtracking: half of the inputs the rules run over are
remote-controlled), a pattern or URL over the length caps, and a rule of an unknown kind all
refuse at boot rather than at fetch time. A mirror changes only where the bytes come from:
the index document goes through the same parser, the release asset is still verified against
the entry's sha512 integrity, and a mirror serving tampered bytes is refused like any other
source.

Where npm fetches the packages themselves from is a choice on the Settings page (Plugin
sources): the official registry first and default, a named mirror beside it. The installer
rides the choice as `--registry` on every npm run it makes; unset, npm's own configuration
stands, exactly as before.
