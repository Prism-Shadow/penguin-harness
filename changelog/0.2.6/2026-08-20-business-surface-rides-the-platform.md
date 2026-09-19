# The whole business surface rides the hot platform

- **Date:** 2026-08-20
- **Type:** refactor
- **Scope:** `server`, `cli`, `desktop`
- **PR:** [#359](https://github.com/Prism-Shadow/penguin-harness/pull/359)

Every business service and route — `/api/me` through `/api/sessions`, the scheduler, the
session manager — moved out of the runtime shell and into the platform: assembled inside
`platformImpl.create()` over capabilities the runtime publishes through the resource
registry (database handle, auth service, channel hub, config, proxy control, desktop
service), and served through the HTTP seam. A hot push therefore replaces the business
wholesale; the runtime keeps mechanism only — transport, auth routes, HMR, static hosting.

## Details

- The former `platform/` folder dissolved into its successors: `hmr/` (the swap machinery
  and the packaged platform), `app.ts` (both surfaces' assembly) and `terminal/`.
- Each App registers one route table and publishes itself as one unit, so no reader can
  observe a half-swapped pair; swap semantics for unparked state are a hard stop, with
  terminals as the parked exception that rides across.
- The capability handshake is structural: the runtime publishes an interface descriptor
  (member sets per capability, plus a family), and a booting platform verifies the
  declaration against the live objects before claiming anything.
- The startup lifecycle became a sequence of one-method steps led by `main()`; the CLI and
  desktop dropped a redundant `PENGUIN_HOME` read that `resolveRoot()` already performs.
