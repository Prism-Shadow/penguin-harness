# The Linux sandbox has a documented step for Ubuntu 23.10 and later

- **Date:** 2026-09-29
- **Type:** fix
- **Scope:** `plugins`, `docs`

[中文版](2026-09-29-sandbox-ubuntu-userns.zh.md)

On a default Ubuntu 24.04, `kernel.apparmor_restrict_unprivileged_userns` is `1`: only programs with an AppArmor profile that allows it may create user namespaces. The desktop `.deb` installs such a profile for the app, and the bubblewrap the app starts inherits it. The install script, the npm install and the release archive could not, so `@penguinharness/sandbox-bwrap` failed its startup check there, and the docs named only Debian's switch.

- The CLI quickstart gains a **Sandbox on Ubuntu** section. It gives the one-time root step, a profile for the bubblewrap the backend ships, matched by a path pattern that covers both a download into the data root and the installation's bundled plugins, so later versions stay covered. It also names the two alternatives: a profile for a root-owned bubblewrap, or lowering the switch for every program.
- When the backend cannot build its base profile, the reason on the Sandbox card now names Ubuntu's switch next to Debian's, and points to the new section.
- The backend's README states the requirement for Ubuntu.
