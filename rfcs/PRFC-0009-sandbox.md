# PRFC-0009 Sandbox: policy fails closed, backend is a plugin

[中文版](PRFC-0009-sandbox.zh.md)

> **Source**: `rfcs/PRFC-0009-sandbox.md` from the design repository [penguin-harness-design](https://github.com/Prism-Shadow/penguin-harness-design) — landed (default branch `main`, commit [`ac673a24`](https://github.com/Prism-Shadow/penguin-harness-design/commit/ac673a245eec78d6afca35e260dce28b2a3ab3ac)).
> **Rev**: v1.0.0 (migrated into the main repository); the conventions for this surface are in [README.md](README.md), and per-version changes are recorded in the `## Changes` section at the end.

- Feature Name: `sandbox`
- Start Date: 2026-10-04
- PRFC PR: [Prism-Shadow/penguin-harness-design#263](https://github.com/Prism-Shadow/penguin-harness-design/pull/263)
- Implementation PR: [Prism-Shadow/penguin-harness#354](https://github.com/Prism-Shadow/penguin-harness/pull/354) (interface and backend plugins), [Prism-Shadow/penguin-harness#769](https://github.com/Prism-Shadow/penguin-harness/pull/769) (settings groups and the per-Session snapshot), [Prism-Shadow/penguin-harness#893](https://github.com/Prism-Shadow/penguin-harness/pull/893) (the four executor kinds), [Prism-Shadow/penguin-harness#972](https://github.com/Prism-Shadow/penguin-harness/pull/972) (the Windows session shell), [Prism-Shadow/penguin-harness#975](https://github.com/Prism-Shadow/penguin-harness/pull/975) (the switch and presets), [Prism-Shadow/penguin-harness#978](https://github.com/Prism-Shadow/penguin-harness/pull/978) (the Landlock floor and per-dimension routing)

## Summary
[summary]: #summary

The sandbox is a Session-level runtime constraint. This PRFC sets out, in order:

1. **The sandbox interface**: a policy consists of four dimensions — file mode, network tier, masked paths and the temporary directory; backend plugins declare which dimensions they implement, and the harness routes the policy to a backend that can cover it; when no backend can, execution is refused (fail closed), never downgraded to running unconfined.
2. **Default presets**: a preset is a named combination of "file × network × approval mode"; when the sandbox switch is on, new Sessions start from the default preset, Workspace Write. The tables that follow list, per backend, which paths each preset can read and write.
3. **The default-backend decision tree**: which backend each platform recommends, which backend actually serves, and how it fails when none is available.
4. The reasons for this design, and its limitations.

## Motivation
[motivation]: #motivation

- **"The sandbox is installed but nothing is confined" is far more dangerous than "the command is refused"**: the user cannot tell whether the command was isolated at all, and one silent downgrade makes the whole capability meaningless.
- **No single mechanism covers every host**: bubblewrap is refused by AppArmor's userns restriction on a default Ubuntu 24.04; macOS has only Seatbelt; Windows has no equivalent native mechanism. The interface must accommodate multiple backends of differing capability, and say truthfully what this machine enforces.
- **Only a few combinations are used day to day**: the composer's permission menu used to be three sections and ten options ([#975](https://github.com/Prism-Shadow/penguin-harness/pull/975)).

## Guide-level explanation: what the sandbox interface is
[guide-level-explanation]: #guide-level-explanation

### Policy: four dimensions

| Dimension | Values | Requires the backend to implement |
| --- | --- | --- |
| File mode | `read-only` (nothing writable but the temporary directory) / `workspace-write` (the Workspace, the Session scratchpad and the temporary directory writable) / `danger-full-access` (no file confinement) | `fs-write`: the floor every backend must implement |
| Network tier | `open` / `local` (Localhost only) / `none` | `none` → `network`; `local` → `network-local` |
| Masked paths | a list of absolute paths (≤ 64 entries), reads hidden too | non-empty → `mask-paths` |
| Temporary directory writable | on by default; off leaves the temporary directory read-only as well | off in a confining mode → `closed-temp` |

A policy requires only the dimensions it actually uses. With the file mode `danger-full-access` and no other dimension required, the command runs as-is; a policy that keeps full access but still cuts the network or masks paths needs a backend just the same. `network-local` is a dimension of its own, because a backend that can cut the network cannot necessarily keep the host's loopback reachable while doing so; `closed-temp` is a dimension of its own, because not every backend can close the temporary directory.

### Who sets the policy

```text
Server-side sandbox settings (admin): switch, default preset, temporary directory, masked paths
        │  snapshotted when a Session is created; decoupled from the settings from then on
        ▼
Session policy: file mode, network tier, approval mode (sub-sessions inherit the root session's)
        │  changed by that Session's PATCH; a non-admin can only tighten, never go wider than the server-side starting point (the ceiling)
        ▼
Every spawn: the harness hands the policy to a backend
```

Changes to the settings affect only Sessions created afterwards. The ceiling compares the file mode (read-only < workspace-only < full access) and the network tier (no network < localhost only < open) separately; the composer's grey-out and the server's refusal share the same comparison.

### What gets confined

Commands, hook scripts, `stdio` MCP Servers and the file tools are confined through the same seam, under the same Session policy; the writable ranges and the uncovered items are in 05 "Sandbox" (design [#222](https://github.com/Prism-Shadow/penguin-harness-design/pull/222)). A Project's command policy is regex interception at the approval boundary, not a sandbox; the two complement each other (design [#50](https://github.com/Prism-Shadow/penguin-harness-design/pull/50)).

### The backend contract

```ts
type SandboxDimension = "fs-write" | "network" | "network-local" | "mask-paths" | "closed-temp";

interface SandboxProvider {
  dimensions?: SandboxDimension[];             // defaults to ["fs-write"]
  mechanism?: string;                          // what enforces it, e.g. "bubblewrap", "Landlock (partial)"
  limits?: { text: string; textZh: string }[]; // the gaps left on this machine
  confine(argv: string[], policy: SandboxPolicy): ConfinedArgv; // throws when it cannot enforce
}

interface ConfinedArgv {
  argv: string[];                              // the rewritten argv; must not be returned unchanged
  enforcement?: "full" | "partial";            // reported only, never requested
  denialSignatures?: string[];                 // the dialect of refusals on stderr
  runnerFailureRules?: RunnerFailureRule[];    // evidence of the runner itself failing, informationalLines included
}
```

Three rules:

- **Backends only rewrite argv.** The harness spawns the rewritten argv as usual, and the process runs under the backend's confinement; the backend does not interpret commands.
- **Capability is self-reported.** A backend self-checks at load: it fails the load when it cannot serve on this machine, and declines when this is not its platform, rather than mounting a backend that refuses every command. Partial enforcement is reported once, structurally, at load, through `mechanism` and `limits`.
- **Fail closed.** The harness picks, among the mounted backends, one that implements every required dimension; when none exists it refuses the spawn, with an error naming the required dimensions, what each mounted backend covers, and each backend not in use with its reason.

## Reference-level explanation
[reference-level-explanation]: #reference-level-explanation

### Default presets

The top of the Sandbox card is the **switch**. Off, a new Session is unconfined and bound only by its approval mode, and the composer's shield button lists approval modes alone; on, a new Session starts from the **default preset**'s file mode, network and approval mode, plus the temporary directory and masked paths from the card's Advanced fold. On a fresh install the switch is off.

Factory presets (network open for all):

| Preset | Files | Network | Approval mode | In menu by default | Purpose |
| --- | --- | --- | --- | --- | --- |
| Full Access | Full access | Open | Approve everything | Yes | work you trust and watch; the three columns locked |
| Always Ask | Full access | Open | Ask every time | Yes | approving the work step by step |
| **Workspace Write** (default) | Workspace write only | Open | Approve everything | Yes | everyday coding |
| Read Only | Read-only | Open | Approve everything | Yes | browsing code, reviewing, answering questions |
| Workspace Write with Ask | Workspace write only | Open | Ask every time | No | careful edits |
| Denied All | Full access | Open | Deny everything | No | a conversation with no tool use |

- **Workspace Write by default**: everyday coding goes uninterrupted while writes stay inside the Workspace; the open network means it requires only `fs-write`, so it can be enforced on any host that has a backend (hosts with only the Landlock floor included — see the next section).
- **A preset is only a name plus a mapping**: a Session stores only its own file mode, network and approval mode, and the menu names it after the first row holding the same values. Renaming, pinning to the menu, reordering, changing the default — none of it touches an existing Session.
- **Extensible**: an admin can add presets (a new row defaults to Workspace write only / Open / Ask every time); only added rows can be deleted, and built-in rows can only be unpinned.
- **Choices are bounded by the ceiling and by enforceability**: a preset wider than the ceiling is greyed out for a non-admin; a preset this machine's backends cannot enforce is greyed out with its reason (for example "No network" when only Landlock is available). Picking one is a single `PATCH`: every field is validated before anything is written, and a refusal leaves the Session as it was.
- **Unattended Sessions** (organization Sessions, scheduled tasks, Sessions created by workflows) start with "Approve everything", not the default preset's approval mode: nobody is present to answer approvals.

#### Paths accessible under each preset

Example: user `alice`, Workspace `~/code/app`, Session `s1` belonging to Agent `coder` of Project `demo`; the masked-paths rows assume the admin masked `~/.ssh/` (empty from the factory).

| Column | Preset |
| --- | --- |
| Full | Full Access |
| Ask | Always Ask |
| WsWrite | Workspace Write (default) |
| WsWriteA | Workspace Write with Ask |
| Read | Read Only |
| DeniedAll | Denied All |

| Cell | Meaning |
| --- | --- |
| rw | read-write |
| ro | read-only |
| masked | invisible (directories list as empty, files read as empty) |
| denied | the command does not run |
| — | no such path in that environment |

Full and Ask go through no backend; the cells show the harness's own permissions.

##### Linux (bubblewrap)

| Path | Full | Ask | WsWrite | WsWriteA | Read | DeniedAll |
| --- | --- | --- | --- | --- | --- | --- |
| `/home/alice/code/app/` (Workspace) | rw | rw | rw | rw | ro | denied |
| `/home/alice/.penguin/data/demo/agents/coder/scratchpad/s1/` (scratchpad) | rw | rw | rw | rw | ro | denied |
| `/tmp/` (private per command and initially empty under WsWrite, WsWriteA, Read) | rw | rw | rw | rw | rw | denied |
| `/dev/null` | rw | rw | rw | rw | rw | denied |
| `/home/alice/.penguin/data/` | rw | rw | ro | ro | ro | denied |
| `/etc/`, `/usr/` | ro | ro | ro | ro | ro | denied |
| `/home/alice/.ssh/` (masked) | rw | rw | masked | masked | masked | denied |

##### Linux, bubblewrap unavailable (DSH · Landlock)

| Path | Full | Ask | WsWrite | WsWriteA | Read | DeniedAll |
| --- | --- | --- | --- | --- | --- | --- |
| `/home/alice/code/app/` (Workspace) | rw | rw | rw | rw | ro | denied |
| `/home/alice/.penguin/data/demo/agents/coder/scratchpad/s1/` (scratchpad) | rw | rw | ro | ro | ro | denied |
| `/tmp/` (shared with the host) | rw | rw | rw | rw | ro | denied |
| `/dev/null` | rw | rw | rw | rw | rw | denied |
| `/home/alice/.penguin/data/` | rw | rw | ro | ro | ro | denied |
| `/etc/`, `/usr/` | ro | ro | ro | ro | ro | denied |
| `/home/alice/.ssh/` (masked): DSH does not support masking; policies with masked paths are refused | rw | rw | denied | denied | denied | denied |

##### macOS (Seatbelt)

| Path | Full | Ask | WsWrite | WsWriteA | Read | DeniedAll |
| --- | --- | --- | --- | --- | --- | --- |
| `/Users/alice/code/app/` (Workspace) | rw | rw | rw | rw | ro | denied |
| `/Users/alice/.penguin/data/demo/agents/coder/scratchpad/s1/` (scratchpad) | rw | rw | rw | rw | ro | denied |
| `/private/tmp/`, `/private/var/folders/…/T/` (shared with the host) | rw | rw | rw | rw | rw | denied |
| `/dev/null`, `/dev/stdout`, `/dev/stderr`, `/dev/dtracehelper` | rw | rw | rw | rw | rw | denied |
| `/Users/alice/.penguin/data/` | rw | rw | ro | ro | ro | denied |
| `/etc/`, `/usr/` | ro | ro | ro | ro | ro | denied |
| `/Users/alice/.ssh/` (masked) | rw | rw | masked | masked | masked | denied |

##### Windows (WSL)

Commands under confined presets run inside a dedicated Linux distro, where Windows paths appear under `/mnt/<drive-letter>/`; Full and Ask run directly on Windows.

| Path | Full | Ask | WsWrite | WsWriteA | Read | DeniedAll |
| --- | --- | --- | --- | --- | --- | --- |
| `C:\Users\alice\code\app\` (Workspace; `/mnt/c/Users/alice/code/app/` inside the distro) | rw | rw | rw | rw | ro | denied |
| `C:\Users\alice\.penguin\data\demo\agents\coder\scratchpad\s1\` (scratchpad; `/mnt/c/…` inside the distro) | rw | rw | rw | rw | ro | denied |
| Other paths under `C:\Users\alice\` (ro once "Show Windows drives read-only" is on) | rw | rw | masked | masked | masked | denied |
| `C:\Windows\` | ro | ro | masked | masked | masked | denied |
| `/tmp/` inside the distro (private per command) | — | — | rw | rw | rw | denied |
| `/dev/null` inside the distro | — | — | rw | rw | rw | denied |
| `/etc/`, `/usr/` inside the distro | — | — | ro | ro | ro | denied |

##### Windows, WSL unavailable (DSH · Windows ACL, requires PowerShell)

| Path | Full | Ask | WsWrite | WsWriteA | Read | DeniedAll |
| --- | --- | --- | --- | --- | --- | --- |
| `C:\Users\alice\code\app\` (Workspace) | rw | rw | rw | rw | ro | denied |
| `C:\Users\alice\.penguin\data\demo\agents\coder\scratchpad\s1\` (scratchpad) | rw | rw | ro | ro | ro | denied |
| `C:\Users\alice\AppData\Local\Temp\` (under confined presets only a random subdirectory of it is writable — one per command, deleted when it ends) | rw | rw | rw | rw | ro | denied |
| `NUL` | rw | rw | rw | rw | rw | denied |
| `C:\Users\alice\.penguin\data\` | rw | rw | ro | ro | ro | denied |
| `C:\Windows\` | ro | ro | ro | ro | ro | denied |
| `C:\Users\alice\.ssh\` (masked): DSH does not support masking; policies with masked paths are refused | rw | rw | denied | denied | denied | denied |

Further notes:

- With the **temporary directory closed**, the temporary directory under bubblewrap, Seatbelt and WSL goes from "read-write" to "read-only"; DSH does not support this, so such a policy is never routed to it — likewise masked paths.
- **"Read-only" limits writes only.** `~/.ssh` and `~/.penguin/data` get no special treatment; reads are unrestricted — the only way to hide them is masked paths.
- Windows ACL confinement is partial: objects writable by Everyone, hard links, and files on FAT volumes stay writable.

### The default-backend decision tree

Backend plugins and the dimensions each implements:

| Plugin | Platform | `fs-write` | `network` | `network-local` | `mask-paths` | `closed-temp` |
| --- | --- | --- | --- | --- | --- | --- |
| `sandbox-bwrap` (bubblewrap) | Linux | ✓ | ✓ | | ✓ | ✓ |
| `sandbox-seatbelt` (Seatbelt) | macOS | ✓ | ✓ | ✓ | ✓ | ✓ |
| `sandbox-wsl` (bubblewrap inside a dedicated WSL2 distro) | Windows | ✓ | ✓ | | ✓ | ✓ |
| `sandbox-dsh` (DSH's platform chain) | Linux / macOS / Windows | ✓ | | | | |

**Routing rule**: among the mounted backends that implement every dimension the policy requires, the one implementing the most dimensions serves; registration order (the order of the Project's plugin list) only breaks ties. So with bwrap and DSH both mounted, bwrap serves every policy, and DSH serves only when it is the only backend left.

```text
Linux     card recommends: sandbox-bwrap + sandbox-dsh
├─ bubblewrap self-check passes ───────────── bwrap serves (4 dimensions)
├─ bubblewrap refused (the AppArmor userns restriction on Ubuntu ≥ 23.10, userns off on Debian, inside a Docker container)
│  ├─ DSH chain probes Landlock available ───── DSH serves via Landlock (fs-write only);
│  │                                          the card names why bwrap was refused and the one-time root step back to bwrap
│  └─ neither available ────────────────────── no backend: every confining policy is refused
└─ "Localhost only" network: no backend on Linux implements network-local, always refused

macOS     card recommends: sandbox-seatbelt
├─ sandbox-seatbelt mounted ────────────────── Seatbelt serves (5 dimensions)
├─ only sandbox-dsh ────────────────────────── DSH serves via Seatbelt (fs-write only)
└─ neither ──────────────────────────────────── refused

Windows   card recommends: sandbox-wsl
├─ sandbox-wsl mounted (WSL2 and the dedicated distro ready) ── WSL serves (4 dimensions)
├─ only sandbox-dsh (the ACL restricted-token runner)
│  ├─ session shell is PowerShell ────────── DSH serves (fs-write only, partial)
│  └─ session shell is bash / sh (the default) ─ DSH fails to load; the reason names the fix:
│                                            set PENGUIN_SHELL=pwsh (or powershell), then restart
└─ neither ────────────────────────────────── refused
```

When the switch is on and this machine has no backend, the card prompts to install the platform's recommended backend. The card also states what this machine enforces and by what — for example "Enforced here: file writes, by Landlock (dsh-local). Not enforced here: network isolation…" — and the folded "More info" lists the limits of the backends in use and the reason for every backend not in use. After the settings are saved, a backend that failed to load is retried once; fix the host and it mounts — no restart needed.

## Rationale and alternatives
[rationale-and-alternatives]: #rationale-and-alternatives

- **Fail closed, not fall back to unconfined when a backend is missing.** The latter would decouple "looks sandboxed" from "is sandboxed". A refusal is visible and carries its remedy; a preset that cannot be enforced is greyed out up front on the card and in the composer, not loosened at run time.
- **Backends are plugins.** The mechanisms differ widely across platforms and evolve at different paces, and the platform itself depends on none of them; a new system mechanism only implements `confine` and declares its dimensions truthfully — the routing rule does not change.
- **Route by capability, not by registration order.** Registration order comes from the Project's plugin list and has nothing to do with safety; taking the first in order could let DSH grab a policy that bwrap should have served. Taking by dimension count means the one that can do more always serves.
- **DSH is the floor, not the default.** DSH's policy vocabulary governs file writes only and cannot take network or masked paths; making it the default would make those dimensions disappear on every host. Its value is that file writes stay confined when bwrap is refused, so the factory presets can be enforced on a default Ubuntu without root.
- **Follow DSH's contract, don't rewrite it.** The report lines the Landlock launcher prints on every run under an older ABI are declared by DSH as `informationalLines`; the harness strips them from the head of stderr only, and hangs no filter when DSH declares none. On Windows, the lookup of a bare program name belongs to DSH's runner. Writing our own regex or PATH lookup would maintain the same fact in two places: the hand-written PATH lookup we once had disagreed with Windows / libuv semantics, and the "same-named exe inside the Workspace shadowing another" it guarded against runs under the same restricted token and is no escape — it has been withdrawn. A per-command "partially enforced" notice was rejected too: the verdict is host-level, and reporting once at load is enough.
- **Keep the Windows default shell.** Changing the default shell to PowerShell would change every Windows user; swapping the shell only in confined Sessions would make the shell part of the sandbox contract, while the shell is resolved once per process and written into the system prompt. So it is checked only when DSH loads and before each command, and the failure names `PENGUIN_SHELL`.
- **A preset is a name plus a mapping, not a new policy type.** Session storage, the enforcement paths and the ceiling comparison are unchanged; no edit to a preset touches an existing Session.

## Drawbacks: limitations
[drawbacks]: #drawbacks

- **Misconfiguration means nothing runs.** With no backend, a backend that failed to load, or a dimension the policy requires that this machine does not have, every command under a confining mode is refused. That is the intended cost.
- **The Landlock floor is narrower than bwrap.** The temporary directory is the host's shared `/tmp`, which can be neither closed nor made private; on Landlock ABI below 5 (Linux 6.10), ioctl on device files outside the Workspace is not restricted, and below ABI 3 (Linux 6.2) neither is truncating a file outside the Workspace.
- **DSH cannot cut the network, mask paths, or close the temporary directory.** When DSH is the only backend serving, the "No network" and "Localhost only" presets are greyed out and refused on save, and a confining policy with masked paths or the temporary directory closed is refused; DSH's policy takes only a mode and the Workspace, so under every tier the Session scratchpad is not writable, and under Read Only the temporary directory is not writable either.
- **The "Localhost only" network is implemented by Seatbelt alone**; choosing it on Linux or Windows is refused.
- **The Windows ACL tier is always partial**: the restricted token must keep Everyone for the process to initialize, so external objects granting Everyone write access stay writable; NTFS hard links can make a path inside and outside the Workspace point at the same file.
- **Using DSH on Windows requires switching to a PowerShell session shell**; Skills aimed at POSIX shells may not run directly, and a restart is needed after the change.
- **The AppArmor step back to bwrap needs root once**: install methods other than the desktop `.deb`, and Docker containers, cannot bring their own profile.
- **Report-line filtering covers commands and hook scripts only**: `stdio` MCP Servers and the file tools still see Landlock's partial report lines; a command's own first line of stderr, if verbatim the same as that line, is dropped.
- **The harness does not distinguish refusals from runner failures**: `denialSignatures` and `runnerFailureRules` come back with every rewrite, and the harness uses only the `informationalLines` among them to filter report lines.

## Prior art
[prior-art]: #prior-art

- **DSH (the sandbox of DeepSeek Harness)**: argv rewriting, truthful reporting of how complete the enforcement is, fail closed, and the shapes of `denialSignatures` / `runnerFailureRules` all take it as the blueprint. This project's interface is its own, so it can name dimensions that DSH's vocabulary explicitly excludes (network, masked paths); DSH is one adaptor behind the interface.
- **bubblewrap, Landlock, Seatbelt (`sandbox-exec`), WSL2**: the system mechanisms the backends use directly.

## Unresolved questions
[unresolved-questions]: #unresolved-questions

- **The session shell becomes a setting (proposed, undecided)**: `system_config` gains a session shell, with priority `PENGUIN_SHELL` > the setting > auto-detection; when DSH is unavailable because of bash, the card offers a one-click fix that takes effect after a restart. A per-Session shell is rejected for now, for the reasons above.
- **The line on Linux's recommended backend**: recommend `sandbox-bwrap` alone, or, as this document does, both `sandbox-bwrap` and `sandbox-dsh`.
- **`/tmp` under Landlock and the scratchpad under DSH**: whether, and how, to give commands under DSH a private temporary directory and a writable scratchpad.

## Future possibilities
[future-possibilities]: #future-possibilities

- Escalation: tell "refused by the sandbox" from "runner failure" using `denialSignatures` and `runnerFailureRules`, and on that basis decide what happens after a refusal.
- More backends: dimensions and the routing rule unchanged, a new mechanism only implements `confine` and declares its dimensions truthfully — filling `network-local` in for Linux, for example.

## Changes

### v1.0.0

- Added: migrated into the main repository; the body takes the landed version from the design repository's default branch, identical to the source file.
