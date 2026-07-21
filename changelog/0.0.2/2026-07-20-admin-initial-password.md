# The admin initial password becomes penguin-2026

`admin123` sits in every breach corpus, so Chrome flags the first login as a compromised password; the seeded admin now starts as `penguin-2026` — unflagged, brand-related, all lowercase plus a hyphen so it stays easy to type.

The value swaps everywhere it appears: the server seed (`ADMIN_INITIAL_PASSWORD`), the release installer's first-login hint, READMEs, docs (quickstart / web-app / server-api), blog posts, landing quickstart copy, the screenshot capture scripts, and the e2e auth helper. The change-it-soon banner semantics are unchanged.
