# macOS Seatbelt sandbox backend

The macOS counterpart to the bubblewrap backend, built on `sandbox-exec` (Seatbelt).
Implements **all three** dimensions of the harness sandbox interface — filesystem writes,
network isolation and path masking — as policy rules rather than mounts.

## Requirements

- macOS, with `sandbox-exec` available (part of the base system).

## How the profile is built

```scheme
(allow default)                              ; start from the host's world
(deny file-write*)                           ; nothing is writable…
(allow file-write* (literal "/dev/null") …)  ; …beyond the required sinks
;; workspace-write
(allow file-write* (subpath "<workspaceRoot>") …)
;; network: none
(deny network*)
;; mask-paths
(deny file-read* file-write* (subpath "<p>"))
```

Rule **order** is the counterpart to bwrap's mount order: in SBPL the *last* matching rule
wins, so mask denials are emitted after the write allowances — otherwise masking a path
inside the workspace would be overridden by the workspace's own allowance.

Paths are canonicalized before entering the profile. Seatbelt matches the real filesystem
path, and on macOS `/tmp` and `/var` are symlinks into `/private`, so an uncanonicalized
subpath rule silently matches nothing.

## Install

Add the specifier to your deployment's `extensions.json` and restart, or push a platform that
carries it:

```json
{ "extensions": ["@prismshadow/penguin-extension-sandbox-seatbelt"] }
```

Installing is an operator-side action: the harness resolves the package from the installation,
never from this listing.

## License

Apache-2.0.
