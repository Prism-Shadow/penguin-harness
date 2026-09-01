# Persistent SSH session — expect template

Full template for mode 1 (persistent SSH session). Write it to your scratchpad
(`<app_data_dir>/agents/<agent_id>/scratchpad/remote_shell.exp`) and fill the placeholders at
runtime — never commit real values, and have expect read the password from the environment rather
than baking it into the file.

```expect
#!/usr/bin/expect -f
set timeout 30
log_user 0
set env(TERM) xterm-256color          ;# must be set before spawn — see the TERM note below
spawn ssh -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=30 \
    -o ServerAliveCountMax=3 -o ConnectTimeout=15 <ssh-user>@<remote-host>
expect {
    "yes/no"    { send "yes\r"; exp_continue }
    "password:" { send "$env(REMOTE_SSH_PASSWORD)\r"; exp_continue }
    eof         { puts "\n=== SSH CLOSED ==="; exit 1 }
}
sleep 2
send "su - <target-user>\r"           ;# drop this block when no user switch is needed
expect {
    "Password:" { send "$env(REMOTE_SSH_PASSWORD)\r"; exp_continue }
    timeout { }
}
sleep 1
send "echo PERSISTENT_SESSION_READY; whoami; hostname; pwd\r"
expect "PERSISTENT_SESSION_READY"
log_user 1
set timeout -1
interact
```

## Operating notes

- Start it with `exec_command` and let it keep running — the closing `interact` holds the
  connection open, and its `process_id` is your handle: send remote commands with `input_command`
  (write to stdin) and poll the same session for new output.
- The `sleep`-based waits replace prompt-regex matching on purpose: matching shell prompts
  (`[$#] $` and friends) breaks on MOTD/ANSI noise and leaves the script stuck in `expect`.
- `set env(TERM) xterm-256color` before `spawn`, or the remote shell sees `TERM=dumb` and TUIs
  render badly.
- Probe before relying on the session (`echo PING; whoami`), and reuse it for most remote commands
  — open extra one-shot connections sparingly.
- When finished: stop the expect process you started (and its ssh child; leave other people's
  sessions alone) and delete the script from the scratchpad.
