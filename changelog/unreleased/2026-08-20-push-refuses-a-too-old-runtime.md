# A hot push onto a runtime that is too old now fails instead of landing half a version

- **Date:** 2026-08-20
- **Type:** fix
- **Scope:** `server`

Pushing a current bundle to an installation whose runtime predates the resource-interface
handshake left the machine serving the **new** frontend against the **old** API: the browser
crashed with `Cannot read properties of undefined (reading 'attachmentLimitMinMb')` on opening
Upload limits, because `/api/me` was still the previous version's.

The push itself is atomic — platform, CLI and web dist are committed as one version — but the
platform it delivers has to *claim* the runtime's business capabilities before it can serve the
business API. A runtime too old to publish them made that claim fail, and the platform's answer
was to degrade to a terminals-only App: it declined every business route, the seam handed those
requests back to the runtime, and that older runtime answered them out of its own built-in
routes. One atomic push therefore landed as half a version, silently, reported as a success.

A platform that cannot claim the capabilities now refuses to boot. The upgrade rolls back the
way any failed boot does — the running version keeps serving, the web dist is not committed,
nothing is persisted — and the push reports the reason, which is that the installation itself
has to be updated: a push replaces the platform, never the runtime. A machine already carrying
such a half version needs that update too — the committed bundle predates the check, so a
restart restores it degraded again; updating the installation lets the same committed bundle
claim successfully and serve whole (or clear `<data root>/hmr/harness.json` to fall back to
the packaged version).

A host that genuinely has no business runtime behind it (a bare kernel) says so explicitly and
still gets a terminals-only platform. Being *unable to answer* is no longer read as *asking for
terminals only*.
