# Windows account sandbox backend

Confinement by **identity**: each agent command runs as a dedicated local account that owns
nothing. What it may touch is what the setup granted; everything else is already out of reach,
because one local user cannot read another's profile.

Implements all three dimensions of the harness sandbox interface.

| Dimension | How |
| --- | --- |
| `fs-write` | The Workspace is opened to the sandbox group — Modify under `workspace-write`, Read and Execute under `read-only` |
| `network` | Two accounts: `network: "none"` runs as the one three firewall rules block outbound (including loopback) |
| `mask-paths` | An explicit Deny for the group, which outranks the Workspace's own grant |

## Why not a container

Windows' container mechanisms cannot run the shell this harness uses, and that was measured, not
assumed:

- **MXC `processcontainer`** is an AppContainer. An MSYS2 shell (Git Bash) dies inside one at
  `STATUS_DLL_INIT_FAILED` (0xC0000142) while creating `\BaseNamedObjects\msys-*` — the global
  object namespace an AppContainer exists to deny. Granting files, adding capabilities and the
  SDK's own recommended policy all leave it exactly where it was.
- **A restricted token** (the DSH rung) fails one step later: `couldn't create signal pipe,
  Win32 error 5`.

An ordinary token that belongs to someone else has neither problem, which is what this backend
uses — the same shape Codex ships on Windows.

The cost is honest: a sandbox account is a normal account. Anything readable by every local user
stays readable, and isolation ends at the filesystem and the network.

## Setup

Once, from an **elevated** PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File setup\penguin-sandbox-setup.ps1
```

It creates the local group `PenguinSandboxUsers`, the accounts `PenguinSandboxNoNet` and
`PenguinSandboxNet` (Windows caps an account name at 20 characters, hence the short forms), the
three firewall rules that block the offline one, and one state file
(`%ProgramData%\penguin\sandbox-winuser.json`) naming them. The accounts' passwords are random
and never displayed; the state file's permissions are their protection — Administrators, SYSTEM
and the account the harness runs as (`-ServerUser`, by default whoever runs the script).

`-Remove` takes all of it away again.

Until the setup has run, the backend declines to load and the Sandbox card says so, with the
command to run. It never lets an agent command fail with a raw Windows error instead.

## Settings

On **Settings → Plugins**, inside the Sandbox card: **Open the shell's directory** (on by
default). A shell installed under your profile is unreadable to any other account, so the
sandbox accounts are given read and execute on its install directory; without it the command
cannot start at all.

## Install

It ships with the harness build. On the Plugins page, install it to the Project whose agent
commands should be confined.
