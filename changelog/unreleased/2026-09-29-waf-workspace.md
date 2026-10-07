# Penguin manages its own WAF workspace

- **Date:** 2026-09-29
- **Type:** feat
- **Scope:** `server`, `activities`

A new `WafWorkspace` service keeps the checkouts activities need under `<PENGUIN_HOME>/waf`, laid out like a WAF checkout: `framework` (branch `v2`), `modules/navbar`, `media` and `waf-activity-data`, plus one repository per product module. Nobody has to clone and maintain a WAF checkout by hand.

- **Prepare** clones whichever shared repositories are missing and runs `npm install --ignore-scripts` in the framework and navbar. It runs in the background, one preparation at a time, and leaves correct clones alone. A clone of a different remote is reported, never overwritten.
- **Media** is cloned partial and sparse with LFS downloads off. A product's folder, such as `loom/<pc>`, is added when needed, and only that folder's LFS objects are fetched.
- **Modules** are cloned on first use from `git@github.com:waterfordresearchinstitute/{module}.git`. A module whose repository does not exist yet starts as an empty repository on `main` with origin set, as Loom started one.
- **An existing checkout** can be used instead, through the `externalRoot` setting or `WAF_ROOT_DIR`. Penguin only reads it; it never clones, installs or fetches into it.

Admin routes are at `/api/admin/waf-workspace`: `GET /` for status, `POST /prepare`, and `GET`/`PUT /settings` for the remotes, branches and module remote template. git uses the host's SSH keys; Penguin stores no git credential. The git port now takes extra environment variables.

Authoring, the sandbox and deploys still find the checkout the old way; they move onto this service next.
