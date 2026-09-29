# Review fixes for activities in modules

- **Date:** 2026-09-29
- **Type:** fix
- **Scope:** `server`, `web`, `activities`

- **An earlier draft's media moves with it.** When a draft moves into its module, its accepted takes (`media/generated/...`) are copied to the paths Loom's layout gives them. Uploads (`media/uploads/...`) go to the ref's `uploads/` folder, and takes not accepted yet go to `candidates/`. The old files stay where they were. A draft that moved before this fix still binds its media at the old paths; its next read moves the media.
- **A Loom ref that fails to open can be opened again.** It is put back as Loom left it: its rows are removed, and Loom's specification and manifest are restored from their `*.loom.json` copies. The product stays in **Open from modules** for the project that owns it, listing only the refs still to open, and opening it again opens just those.
- **The WAF workspace is ready only when it is complete.** It needs all four repositories, including the activity data, each on the branch Settings names. After a branch changes in Settings, **Prepare** switches a clean clone to it and installs its dependencies again. A clone with changes of its own is left alone, and the preparation fails naming it.
- **A new module's first deploy commits its work.** git cannot stash in a repository with no commits yet, so the work now stays where it is. When the module's repository does not exist on its remote, the deploy fails with `module_repository_missing`, naming the repository to create.
- **Deploys publish each media file's Loom sidecar with it.** This covers a sidecar that changed while its file did not.
- **An interrupted renumber no longer breaks the ref.** When a renumber stops partway, the next read moves the manifest's media paths to the new number along with the number itself.
