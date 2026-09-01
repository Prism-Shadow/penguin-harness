# The plugins a deployment runs, and the confinement its commands run under

- **Date:** 2026-09-01
- **Type:** feature
- **Scope:** `server`, `web`

[中文版](2026-09-01-installed-plugins-and-sandbox.zh.md)

The Plugins page listed a catalogue to install *from* and said nothing about what this deployment actually installs, and the sandbox — the confinement every agent command spawns under — could only be configured by editing a parked document. Both now have a surface.

## Installed plugins

An icon beside the Plugins heading opens **Installed plugins**: what `<root>/plugins.json` lists, and which of those the running process holds, as two separate facts. Installed and active differ on purpose — plugins load once per process, in the runtime, so an added specifier is inert until the server restarts and a removed one keeps serving until then; the dialog says exactly that instead of implying the running process changed. Installing a plugin **installs the package**: `POST /api/plugins/installed { specifier }` runs npm into `<root>/plugins`, the one directory the harness owns and can write (an installation directory belongs to its installer — a desktop app's is inside the application bundle), and only then lists it. The loader resolves from that prefix before the installation, so a plugin installed here is the one this deployment loads. Removal takes the package with it. Each catalogue row carries the control, so a plugin is installed where it is read about, and the row then shows what it is for this deployment — installing, waiting for a restart, or running.

Which loaded module belongs to which plugin is answered from the files, never from the host: a package declares its module names in its own `package.json#penguin`, so a listed plugin is active when the modules it declares are all present. A specifier that does not resolve, or resolves to something that is not a plugin package, is reported with that reason rather than as a pending restart. `GET /api/plugins/installed` (any member) and `PUT /api/plugins/installed { plugins }` (admin).

## Sandbox settings

Settings gains a **Sandbox** page (admin): the confinement mode (off / workspace-write / read-only), whether the network is cut off, and the paths masked from confined commands. `GET|PUT /api/admin/sandbox`; a change applies to the next command spawn, with no restart, and the settings park with the platform so they survive a hot update.

What enforces confinement is a backend contributed by a plugin (bwrap, Seatbelt, MXC, DSH). The page lists the mounted backends and the isolation dimensions each implements, and when there are none it says so plainly — a mode chosen without a backend confines nothing, and a security control that implies otherwise is worse than an absent one.
