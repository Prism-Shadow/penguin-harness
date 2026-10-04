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

- The sandbox entry's `backend.recommended` became a list: `@penguinharness/sandbox-bwrap` and `@penguinharness/sandbox-dsh` on Linux, one package on macOS and Windows. Turning the switch on with no backend installed offers the whole list and installs it in order; when one install fails, the prompt closes, the failure is reported, and the card is read again. The Web App still reads the single string an older server reports (see [backward compatibility](2026-10-03-backward-compatibility-sandbox-recommended.md)).
- The card's "Backends:" line was replaced by what the machine enforces and by what, for example `Enforced here: file writes, by Landlock (dsh-local). Not enforced here: network isolation, localhost-only network, masked paths and closing the temporary directory.` It names each backend that adds a dimension the ones before it lack. A collapsed **More info** under that line lists what the serving backends leave open on this host, then each installed backend that is not in use, with its reason and the note that saving the card checks it again. A settings notice may carry `details` / `detailsZh` for this.
- A sandbox provider may declare `limits` (core's `SandboxProvider`), each with English and Chinese text. The DSH adaptor declares that the Session scratchpad is not writable under Workspace Write on any rung. On Landlock it adds that the temporary directory is the host's shared `/tmp`, and on a kernel older than Landlock ABI 5 it explains `(partial)`: ioctl on device files outside the Workspace is not restricted, nor, below ABI 3, is truncating a file.
- With a backend serving and none isolating the network, No network is greyed out in the presets table, naming the backend in use, and a save choosing it is refused, like Localhost only.
- Closing the temporary directory is a dimension, `closed-temp`, which bubblewrap, Seatbelt and WSL declare and the DSH adaptor does not, because every DSH rung grants a temporary directory under Workspace Write. A confining policy that turns **Temporary directory writable** off is routed only to a backend declaring `closed-temp`; with none mounted it fails closed instead of running with temp writable. With only the adaptor serving, the switch is held on with the reason under it, and a save turning it off is refused. A switch that already stands off stays movable. A settings group's `unavailable` may name a boolean field's position, `"true"` or `"false"`.
- The warning that the saved policy cannot be enforced also covers full access that cuts the network or masks paths (a document saved before the presets).
- A sandbox provider may declare `mechanism` (core's `SandboxProvider`): bubblewrap declares `bubblewrap`, and the DSH adaptor declares the rung its chain selected (`Landlock`, `bubblewrap`, `Seatbelt` or the Windows ACL runner, with `(partial)` for partial enforcement).

## Backends

- The DSH adaptor selects its rung when it loads. On Linux this runs the chain's probes, so a host where neither bubblewrap nor Landlock works fails the load with DSH's reason instead of mounting a backend that refuses every command. macOS and Windows have one rung each, which DSH selects without probing.
- On a kernel older than Landlock ABI 5 (Ubuntu 24.04's 6.8 has ABI 4), the Landlock launcher prints `landlock-run: partial enforcement (older Landlock ABI)` on every run. The spawn now drops the lines a backend reports as informational (core's `ConfinedSpawn.runnerLines`) from the head of a command's or hook script's stderr. Later lines are not examined.
- `@penguinharness/sandbox-dsh`, `sandbox-bwrap`, `sandbox-seatbelt` and `sandbox-wsl` are 0.2.3. A machine whose build does not ship them (an npm global install) installs them with npm into `<data root>/plugins/`, and npm publishes each version once: at an unchanged 0.2.2, a machine already holding 0.2.2 there would keep running it, without the `closed-temp` declarations.
- bubblewrap's refusal carries what bwrap said (`setting up uid map: Permission denied`, or the spawn error), and states that the Ubuntu root step is optional and adds network isolation and masked paths.

## The composer

- A Session's sandbox view reports `maskPathsSupported` and, for a policy with masked paths, `masksPaths`. Where no backend masks paths, every preset is greyed out, saying the masked paths would refuse every command.
- The No network reason says the sandbox on this machine confines files only. It and the masked-paths reason name the backends in use, which a Session's sandbox view reports as `backendsInUse`.

## Docs

- The CLI quickstart's **Sandbox on Ubuntu** section, the Settings and Server API pages, and both backends' READMEs describe the default: it works with no step, file writes only through Landlock, and the root step only adds network isolation and masked paths.
