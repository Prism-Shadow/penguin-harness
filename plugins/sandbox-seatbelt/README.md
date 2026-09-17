# macOS Seatbelt sandbox backend

The macOS counterpart to the bubblewrap backend, built on `sandbox-exec` (Seatbelt).
Implements **all three** dimensions of the harness sandbox interface — filesystem writes,
network isolation and path masking — as policy rules rather than mounts.

## The program it runs

`sandbox-exec` is part of macOS: it lives at `/usr/bin/sandbox-exec` on every install, and it is
Apple's to distribute, not this project's — so unlike the Linux backend, which ships its own
bubblewrap, there is nothing here to vendor. What that buys elsewhere, this buys by naming the
absolute path rather than a bare command: a PATH without `/usr/bin`, or one that puts something
else called `sandbox-exec` first, no longer decides what confines a command. The settings can
still name another program, and a host where it does not work is caught by the load-time probe.

## Requirements

- macOS, with `sandbox-exec` available (part of the base system). On any other platform the
  backend declines to mount, so a policy is routed to a backend that host has.

## How the profile is built

```scheme
(allow default)                              ; start from the host's world
(deny file-write*)                           ; nothing is writable…
(allow file-write* (literal "/dev/null") …)  ; …beyond the required sinks
;; workspace-write, and the temp areas when temp is writable
(allow file-write* (subpath "<workspaceRoot>") …)
;; network: none
(deny network*)
;; network: local (only the host's localhost)
(deny network*)
(allow network-outbound (remote ip "localhost:*"))
(allow network-bind (local ip "localhost:*"))
(allow network-inbound (local ip "localhost:*"))
;; mask-paths
(deny file-read* file-write* (subpath "<p>"))
```

Rule **order** is the counterpart to bwrap's mount order: in SBPL the *last* matching rule
wins, so mask denials are emitted after the write allowances — otherwise masking a path
inside the workspace would be overridden by the workspace's own allowance.

Paths are canonicalized before entering the profile. Seatbelt matches the real filesystem
path, and on macOS `/tmp` and `/var` are symlinks into `/private`, so an uncanonicalized
subpath rule silently matches nothing.

## Settings

On **Settings → Plugins**, inside the Sandbox card: the **sandbox-exec program** (a path or a command on PATH; empty uses `sandbox-exec`). It applies at the next command spawn; a changed program is probed afresh. If Seatbelt failed its check at boot, saving the card loads it again, no restart.

## Install

It ships with the harness build. On the Plugins page, install it to the Project that should
run it: the App re-assembles itself, no restart. Written by hand, it is a row of the Project's
`.project_config.toml`:

```toml
[plugins]
"@prismshadow/penguin-plugin-sandbox-seatbelt" = "*"
```

Installing is an operator-side action: the harness resolves the package from the installation,
never from this listing.

## License

Apache-2.0.
