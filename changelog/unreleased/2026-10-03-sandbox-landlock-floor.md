# The Linux sandbox works on a default Ubuntu, through Landlock

- **Date:** 2026-10-03
- **Type:** feature
- **Scope:** `server`, `web`, `plugins`, `core`, `docs`

[中文版](2026-10-03-sandbox-landlock-floor.zh.md)

Turning the sandbox on in Linux offered `@penguinharness/sandbox-bwrap` alone, and on Ubuntu 23.10 and later — where unprivileged user namespaces are granted only to AppArmor-profiled programs — bubblewrap was refused on every install but the desktop `.deb`, so every confining mode refused every command until someone did a root step. The card now installs `@penguinharness/sandbox-dsh` beside it. Where bubblewrap is refused, the DSH adaptor confines file writes through Landlock, which needs no namespace and no root; every built-in preset leaves the network open, so all of them are enforced with no host step.

## Routing

- Of the mounted backends covering a policy, the one implementing the most dimensions serves it; registration order only breaks ties. Where bubblewrap and the DSH adaptor both load, bubblewrap serves every policy, whatever order the plugin lists name them in.
- A policy needing network isolation or masked paths with only the adaptor mounted still fails closed, naming what the adaptor covers and why bubblewrap is not in use.

## The Sandbox card

- The sandbox entry's `backend.recommended` became a list: `@penguinharness/sandbox-bwrap` and `@penguinharness/sandbox-dsh` on Linux, one package on macOS and Windows. Turning the switch on with no backend installed offers the whole list and installs it in order.
- The card's "Backends:" line was replaced by what the machine enforces and by what, for example `Enforced here: file writes, by Landlock (dsh-local). Not enforced here: network isolation, localhost-only network and masked paths.` Each installed backend that is not in use moved under that line into a collapsed **More info**, with its reason and the note that saving the card checks it again. A settings notice may carry `details` / `detailsZh` for this.
- With a backend serving and none isolating the network, No network is greyed out in the presets table, naming the backend in use, and a save choosing it is refused, like Localhost only.
- The warning that the saved policy cannot be enforced also covers full access that cuts the network or masks paths (a document saved before the presets).
- A sandbox provider may declare `mechanism` (core's `SandboxProvider`): bubblewrap declares `bubblewrap`, and the DSH adaptor declares the rung its chain selected (`Landlock`, `bubblewrap`, `Seatbelt` or the Windows ACL runner, with `(partial)` for partial enforcement).

## Backends

- The DSH adaptor runs its chain's probe when it loads, so a host where no rung works fails the load with DSH's reason instead of mounting a backend that refuses every command.
- bubblewrap's refusal carries what bwrap said (`setting up uid map: Permission denied`, or the spawn error), and states that the Ubuntu root step is optional and adds network isolation and masked paths.

## The composer

- A Session's sandbox view reports `maskPathsSupported` and, for a policy with masked paths, `masksPaths`. Where no backend masks paths, every preset is greyed out, saying the masked paths would refuse every command.
- The No network reason says the sandbox on this machine confines files only.

## Docs

- The CLI quickstart's **Sandbox on Ubuntu** section, the Settings and Server API pages, and both backends' READMEs describe the default: it works with no step, file writes only through Landlock, and the root step only adds network isolation and masked paths. The AppArmor profile's path was corrected to the plugin store's layout, `plugin-store/packages/@penguinharness/sa/nd/sandbox-bwrap/…`.
