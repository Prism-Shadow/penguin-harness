# Activities use the WAF workspace

- **Date:** 2026-09-29
- **Type:** feat
- **Scope:** `server`, `web`, `activities`

Module assembly, scene compositions, image previews, the Build checks, the activity sandbox and deploys now read the checkout from the WAF workspace instead of looking for one on disk or taking a folder from the author. The **WAF checkout** field is gone from the activity's Build panel, and `wafRoot` is no longer accepted by `assemble-module`, `compose-video`, `media-image`, `readiness` or the pipeline. `GET .../activities/module-setup` is removed.

**Settings → WAF workspace** (admins only) shows whether each repository is cloned, on which branch and with local changes, and has a **Prepare** button that clones what is missing. Preparing runs on the server and the page updates every two seconds while it does. The same page edits the remotes, branches and module remote, or names an existing checkout for Penguin to read instead. When the workspace is not ready, assembly and the Build check say that an admin can prepare it in Settings.
