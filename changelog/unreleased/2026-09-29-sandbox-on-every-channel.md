# The sandbox backends reach the Docker image, and a registry fetch runs without npm on PATH

- **Date:** 2026-09-29
- **Type:** feature
- **Scope:** `server`, `docker`, `docs`
- **PR:** [Myriad-Dreamin/penguin-harness#98](https://github.com/Myriad-Dreamin/penguin-harness/pull/98)

[中文版](2026-09-29-sandbox-on-every-channel.zh.md)

Before this change, the builtin plugins reached a server through three channels: the CLI package's `lib/plugins`, the desktop app's `plugins/`, and a hot push. The Docker image now brings them too. An npm global install of `@prismshadow/penguin-cli` carries no plugin, only the build's index of the ones published beside it (`plugins/index.json`): there a backend is fetched from the npm registry into the plugin store on the Plugins page, checked against the integrity that index names. A plugin the build's prefix only lists, without carrying it, counts as fetched rather than shipped. A shipped plugin still loads only when a Project asks for it, and the sandbox mode still starts at Off.

## Docker image

- The image builds the builtin plugins prefix with the release's own `build-plugins` step, into `/opt/penguin/lib/plugins`. It is the same prefix the CLI package ships, and it serves both the amd64 and the arm64 image.
- The server looks for the installation's prefix beside the entry's real path. The image starts the program through the `/usr/local/bin/penguin` link, so the server used to look in `/usr/local/plugins`. The same resolution applies when a stored plugin borrows the host's `@prismshadow/penguin-core`.
- The Docker quickstart gains a section on running the sandbox in a container. It lists the options that let bubblewrap create user namespaces (`seccomp`, `apparmor` and `systempaths` set to `unconfined`) and describes what happens without them: the Sandbox card says the backend is not in use and why, and every mode except Off refuses every agent command.

## Registry fetch

- On Windows the fetch starts `npm.cmd` through a shell, which Node requires for a `.cmd` file, with every argument quoted for cmd.exe. An argument that cmd.exe would expand or split is refused.
- A failed fetch reports npm's first `npm error` line. Warnings printed before it and the log pointer printed after it are skipped, and Windows line endings are handled.
- The Plugins, Skills and Server API pages no longer say that nothing is downloaded. A package the build does not ship is fetched from the registry, and a `PUT` of a name that is not on the machine answers `plugin_not_installed`.
