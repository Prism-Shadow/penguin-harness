# Bubblewrap sandbox backend

Confines command subprocesses with [bubblewrap](https://github.com/containers/bubblewrap),
talking to `bwrap` directly. Implements **all three** dimensions of the harness sandbox
interface — filesystem writes, network isolation and path masking.

## Requirements

- Linux, with `bwrap` on PATH. On any other platform the backend declines to mount, so a policy
  is routed to a backend that host has.
- Unprivileged user namespaces enabled. The backend probes functionally at load and
  declines when the kernel will not grant them, rather than confining less than asked.

## How the profile is built

bwrap applies mounts **in order**, and a later mount shadows an earlier one, so the
profile is assembled in this sequence:

| Stage | Flags |
| --- | --- |
| The read-only world | `--ro-bind / /`, `--dev /dev`, `--proc /proc`, `--die-with-parent` |
| writable temp (either mode) | `--tmpfs /tmp`, `--bind <tmpdir> <same>` when `$TMPDIR` is elsewhere |
| `workspace-write` | `--bind <workspaceRoot> <same>` |
| `network: none` | `--unshare-net` |
| `mask-paths` | `--tmpfs <dir>` or `--ro-bind /dev/null <file>` |

Masking comes last on purpose: the entries have to shadow the read-only bind of `/` that
would otherwise expose them. A path that does not exist is skipped — there is nothing to
hide, and materializing an empty directory there would change the filesystem view rather
than restrict it.

## Install

It ships with the harness build. On the Plugins page, install it to the Project that should
run it: the App re-assembles itself, no restart. Written by hand, it is a row of the Project's
`.project_config.toml`:

```toml
[plugins]
"@prismshadow/penguin-plugin-sandbox-bwrap" = "*"
```

Installing is an operator-side action: the harness resolves the package from the installation,
never from this listing.

## License

Apache-2.0.
