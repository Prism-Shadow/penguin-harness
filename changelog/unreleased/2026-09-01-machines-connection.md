# One connection to a machine, and the alias is the target

- **Date:** 2026-09-01
- **Type:** refactor
- **Scope:** `server`
- **PR:** [#597](https://github.com/Prism-Shadow/penguin-harness/pull/597)

[中文版](2026-09-01-machines-connection.zh.md)

Behind the door the previous change put in front of `machines/` there is now **one connection per machine**, and everything this server says to a machine rides it.

## The connection

`ssh -T -D <port> <alias> sh`, held open — the shape VS Code Remote-SSH holds a host with. Commands go down its stdin and come back on its stdout, framed by a per-session random mark so a command that prints anything cannot forge its own terminator. A script or a tarball goes down the **same stdin** as a base64 heredoc, whose terminator cannot occur in the body. And `-D` makes the session a SOCKS server on a loopback port of ours, so any TCP connection to the machine is a channel inside the same ssh session.

An install is therefore: one command to ask what the machine is, the installer on stdin, the store on stdin, one command to ask what it ended up with — four exchanges on one connection, where before each was its own ssh with its own handshake, plus an `scp`.

This is **structure, not a budget**: nothing can open a second connection to a machine, however many callers ask and however often, because there is nothing that could; a second ask queues behind the first. Win32 OpenSSH has no ControlMaster, so one connection cannot be had by sharing a socket between ssh processes — it is had by never starting a second one.

**The exception is a Windows remote.** Its sshd hands commands to cmd.exe, and there is no `sh` to hold a session on, so its PowerShell installer keeps a connection of its own (`oneShot`/`copyTo`, serialised per machine). That is stated where the code is, not left to be discovered.

## The alias is the target

`ssh -G` used to run before an install to resolve the alias. Its only consumed output was the user, handed straight back to ssh as `-o User=…` — and ssh reads the same config, so the round trip asked ssh a question to answer ssh with. Host, port, identity files and jump host were parsed and never read. It also cannot tell an unknown alias from a known one (it prints defaults for any name), so the refusal it fed only ever fired on a broken config or a missing ssh binary.

Gone, with the settings parser behind it. An alias is handed to ssh as written, and what it means is ssh's to apply from its own config every time — nothing here can go stale against a file a person edits. Listing the aliases in the config stays; that is the only thing this app takes from it.

## Compatibility

`POST …/machines/:id/install` no longer answers `502 unresolvable_host`. A config ssh cannot use is reported in ssh's own words, when the connection is opened.
