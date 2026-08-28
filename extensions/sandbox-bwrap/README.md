# Bubblewrap sandbox backend

Confines command subprocesses with [bubblewrap](https://github.com/containers/bubblewrap),
talking to `bwrap` directly. Implements **all three** dimensions of the harness sandbox
interface — filesystem writes, network isolation and path masking.

## Requirements

- Linux, with `bwrap` on PATH.
- Unprivileged user namespaces enabled. The backend probes functionally at load and
  declines when the kernel will not grant them, rather than confining less than asked.

## How the profile is built

bwrap applies mounts **in order**, and a later mount shadows an earlier one, so the
profile is assembled in this sequence:

| Stage | Flags |
| --- | --- |
| The read-only world | `--ro-bind / /`, `--dev /dev`, `--proc /proc`, `--die-with-parent` |
| `workspace-write` | `--tmpfs /tmp`, `--bind <workspaceRoot> <same>` |
| `network: none` | `--unshare-net` |
| `mask-paths` | `--tmpfs <dir>` or `--ro-bind /dev/null <file>` |

Masking comes last on purpose: the entries have to shadow the read-only bind of `/` that
would otherwise expose them. A path that does not exist is skipped — there is nothing to
hide, and materializing an empty directory there would change the filesystem view rather
than restrict it.

## Install

Add the specifier to your deployment's `extensions.json` and restart, or push a platform that
carries it:

```json
{ "extensions": ["@prismshadow/penguin-extension-sandbox-bwrap"] }
```

Installing is an operator-side action: the harness resolves the package from the installation,
never from this listing.

## License

Apache-2.0.
