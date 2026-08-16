# The program moves to the platform's data directory

Installs put the program tree in the XDG data directory (`~/.local/share/penguin`, or `%LOCALAPPDATA%\penguin` on Windows) instead of `~/.penguin`. **Your data does not move**: the data root stays `~/.penguin/data`, which is what `PENGUIN_HOME` defaults to.

## The one-time migration

Re-running the installer — or `penguin update`, which runs it — moves an existing install over: the new tree is installed and smoke-tested at the new location first, and only then are the legacy program directories (`bin`, `lib`, `web`, `node`, and `git` on Windows) removed from `~/.penguin`. `data/` is never touched, and `~/.penguin` itself is removed only if nothing else is left in it. A failure to clear the old copy is a warning, not a failed install.

Setting `PENGUIN_INSTALL_DIR` (or `-InstallDir`) opts out entirely: an explicitly chosen location is a choice, not a layout to migrate. For the same reason `penguin update` no longer passes the old default back to the installer — pinning `~/.penguin` there would have frozen every existing install on the old layout permanently.

## Why

Program and state were interleaved in one directory: upgrades replaced four subdirectories of it and stepped around a fifth. Splitting them puts each where its platform expects it, makes "delete the program" and "delete my data" separate acts, and gives the auto-install path (a server installed onto a machine that does not have one yet) a location to write that is not entangled with a data root that may already exist there.
