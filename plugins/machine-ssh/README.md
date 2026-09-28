# @prismshadow/penguin-plugin-machine-ssh

The ssh machine kind for PenguinHarness. Every alias in the server account's `~/.ssh/config`
is a machine, `ssh:<alias>`, on the Machines page.

This plugin is **resident**: every server loads it whatever its Projects list, because
machines were ssh before machine kinds were plugins. It does not appear in any Project's plugin
list, and syncing a Project's plugins to its machines neither sends it nor removes it.

## How a machine is reached

- **One session per machine.** The server holds `ssh -T -D 127.0.0.1:<port> <alias> sh` and
  writes every command, installer and tarball to its stdin. Every TCP connection to the
  machine (its API, its update endpoint) is a SOCKS channel through that same session, so
  nothing opens a second connection.
- **BatchMode.** ssh never prompts. A host that wants a password fails at once and the page
  says to set up key or agent authentication.
- **Windows remotes** have no `sh` to hold. They are installed through one-shot `ssh` and
  `scp`, and cannot be connected yet.

## Adding a host

The **+** on the Machines page appends a `Host` block to `~/.ssh/config`, led by a
`# Added by PenguinHarness on …` comment. Only blocks with that comment can be edited from the
page; a block you wrote by hand is shown read-only, since it may carry options the form does
not know.

## Port forwards

The Ports page's forwards are ssh's own `-L` and `-R`, carried on the machine's session. On
POSIX the session masters a control socket and forwards are added and removed live
(`ssh -O forward` / `-O cancel`). Windows OpenSSH has no multiplexing, so there the forwards
ride in the session's start arguments and a change reopens the session.
