# Security Policy

[中文版](SECURITY.zh.md)

## Supported versions

PenguinHarness is pre-1.0 and ships from `main`. There are no maintenance branches and
nothing is backported: a fix lands in the next release, and upgrading is the way to get it.

| Version                 | Supported |
| ----------------------- | --------- |
| The most recent release | Yes       |
| Any earlier release     | No        |

The releases are listed in [CHANGELOG.md](../CHANGELOG.md); `penguin version` prints which
build a machine is actually running.

## Reporting a vulnerability

Report privately, through GitHub's
["Report a vulnerability"](https://github.com/Prism-Shadow/penguin-harness/security/advisories/new)
form. It opens a draft advisory only the maintainers can see, and it keeps the discussion,
the fix and the eventual disclosure attached to one another.

If that form is unavailable to you, mail <hiyouga@buaa.edu.cn>. Do not open a public issue,
a discussion, or a pull request for a security problem, and do not post it to Discord or the
WeChat group — those are public.

A report is most useful with the affected version, how PenguinHarness was installed
(desktop app, CLI, or a server run), the operating system, and the smallest sequence of
steps that reproduces the problem. **Strip credentials before you send anything.** A data
root holds provider API keys, messaging bot tokens and Vault entries in readable form, so a
`system_config.yaml`, a `.env`, a Trace or a full log is very likely to carry a secret;
quote the few lines that matter instead of attaching the file.

You will get an acknowledgement of the report and, once someone has looked at it, an
assessment of what it affects and what happens next. This is a small team, so expect days
rather than hours, and expect to be asked for more detail.

## What counts

PenguinHarness runs an agent on your own machine, and that agent runs shell commands, reads
and writes files, and talks to model providers with credentials you configured. Within that
design, these are in scope:

- Anything that lets a Session act outside the boundary the running approval mode
  established — an approval prompt bypassed or spoofed, a `[command_policy]` deny rule
  evaded through a spelling it should have matched.
- Credential exposure: an API key, a bot token or a Vault entry reaching a log, a Trace, an
  error page, an LLM request, or another user's view of the server.
- Anything crossing the multi-user boundary in the server — one account reaching another
  account's Projects, Sessions, Workspaces or usage data, authentication or session-token
  handling that can be defeated, or authorization missing on an API route.
- Remote input that gets to act: a web page, a file, an MCP server or an inbound chat
  message whose content is treated as instructions in a way the user could not see coming,
  or that reaches a tool without passing the approval boundary at all.
- The installers and the update path: an install or `penguin update` that can be redirected
  to code the project did not publish.

These are not, because they are the documented design rather than a defect:

- An agent doing what a tool call you approved permits, including destructive commands under
  `allow-all`.
- The `[command_policy]` sandbox failing to stop a command it never claimed to cover. It is
  documented as a deny-list at the approval boundary and explicitly not a filesystem
  permission or a confinement layer — see
  [Configuration → Command policy](https://penguin.ooo/docs/configuration). Real confinement
  (bubblewrap, dsh) is a separate layer.
- A server deliberately exposed to a network it should not be on. PenguinHarness binds to
  `127.0.0.1` by default; putting it on a public address is a deployment decision.
- Secrets readable on disk by someone who already has your user account or your data root.
- Vulnerabilities in a model provider, an MCP server, or another third-party dependency —
  report those to whoever maintains them. If a dependency's flaw is reachable through
  PenguinHarness in a way its own maintainers would not consider a bug, tell us as well.
