# Installing a plugin from npm

- **Date:** 2026-09-10
- **Type:** feature
- **Scope:** `server`, `web`
- **PR:** [#672](https://github.com/Prism-Shadow/penguin-harness/pull/672)

[中文版](2026-09-10-plugin-npm-install.zh.md)

Asking a Project for a plugin the build does not ship now **installs the package**: `POST /api/projects/:p/plugins/installed { specifier }` runs `npm install` into `<root>/plugins`, the one directory the harness owns and can write (an installation directory belongs to its installer — a desktop app's is inside the application bundle), and only then lists it, so a Project never names a package that is not on the machine. The loader resolves from that prefix before the shipped plugins and the installation. A specifier may carry a version range (`pkg@1.2.3`): that version is installed and recorded as the entry's requirement in the Project's `[plugins]` table (`"pkg" = "1.2.3"`); the key stays the bare name, which is what the loader resolves. npm's own reason is what an install failure reports, not its log pointer; a registry, a proxy or a private scope is configured the way every other npm consumer on the machine configures it.

Removing a plugin from the last Project that asks for it removes the package too, through `npm uninstall` rather than a deletion of its directory: `npm install` records the package in the prefix's manifest, and a directory removed behind npm's back would come back on the next install of anything else.
