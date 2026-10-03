# Bubblewrap sandbox backend

Confines command subprocesses with [bubblewrap](https://github.com/containers/bubblewrap),
talking to `bwrap` directly. Implements **all three** dimensions of the harness sandbox
interface — filesystem writes, network isolation and path masking.

## Requirements

- Linux. On any other platform the backend declines to mount, so a policy is routed to a backend
  that host has.
- Unprivileged user namespaces enabled. The backend probes functionally at load and fails the
  load when the kernel will not grant them, with what bwrap said, rather than confining less than
  asked. Ubuntu 23.10 and later (24.04 by default) grant them only to AppArmor-profiled programs
  (`kernel.apparmor_restrict_unprivileged_userns=1`): the desktop `.deb` installs such a profile;
  the CLI package, the one-line installer, npm and Docker cannot, because the profile needs root.
  There `@penguinharness/sandbox-dsh`, which the Sandbox card installs beside this backend,
  confines file writes through Landlock with no host step. The optional one-time root step that
  lets this backend run, adding network isolation and masked paths, is in the CLI quickstart's
  "Sandbox on Ubuntu" section.

**It brings its own bubblewrap.** The package ships a binary per architecture
(`vendor/linux-x64`, `vendor/linux-arm64`), pinned by URL and sha256 from conda-forge and
vendored at build time by `scripts/vendor-bwrap.mjs`, together with the libcap it loads and both
licenses. A deployment therefore needs nothing installed: no `apt install bubblewrap`, no version
skew between hosts, and no sandbox that is quietly off because a machine lacked the program. The
binary finds its library through an `$ORIGIN/../lib` rpath, which is what makes it usable from a
backend that only rewrites an argv and never sets an environment.

Precedence, when a command is confined: the program named in the settings, else the one shipped
here, else a `bwrap` on PATH.

## How the profile is built

bwrap applies mounts **in order**, and a later mount shadows an earlier one, so the
profile is assembled in this sequence:

| Stage | Flags |
| --- | --- |
| The read-only world | `--ro-bind / /`, `--dev /dev`, `--proc /proc`, `--die-with-parent` |
| writable temp (either mode) | `--tmpfs /tmp`, `--bind <tmpdir> <same>` when `$TMPDIR` is elsewhere |
| `workspace-write` | `--bind <workspaceRoot> <same>`, then `--bind <root> <same>` for each of the policy's `writableRoots` (the Session's scratchpad) |
| `network: none` | `--unshare-net` |
| `network: local` | not supported: an empty network namespace loses the host's loopback too |
| `mask-paths` | `--tmpfs <dir>` or `--ro-bind /dev/null <file>` |

Masking comes last on purpose: the entries have to shadow the read-only bind of `/` that
would otherwise expose them. A path that does not exist is skipped — there is nothing to
hide, and materializing an empty directory there would change the filesystem view rather
than restrict it.

## Settings

On **Settings → Plugins**, inside the Sandbox card: the **bwrap program** (a path or a command on PATH; empty uses `bwrap`) and the **probe timeout** in seconds (1–30, default 5; the confine-time probe blocks the server while it runs). Both apply at the next command spawn; a changed program is probed afresh. If bwrap failed its check at boot (a wrong program, or bubblewrap installed later), saving the card loads it again, no restart.

## Install

It ships with the harness build. On the Plugins page, install it to the Project that should
run it: the App re-assembles itself, no restart. Written by hand, it is a row of the Project's
`.project_config.toml`:

```toml
[plugins]
"@penguinharness/sandbox-bwrap" = "*"
```

Installing is an operator-side action: the harness resolves the package from the installation,
never from this listing.

## License

Apache-2.0.
