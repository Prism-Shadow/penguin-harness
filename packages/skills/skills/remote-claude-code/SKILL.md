---
name: remote-claude-code
description: Run Claude Code on a remote host over SSH — a persistent expect-driven login session, headless claude -p with the stdin fix, the interactive TUI inside a remote tmux driven by send-keys/capture-pane, and multi-turn continuity via --session-id/--resume or stream-json; hosts and credentials are placeholders resolved at runtime from the user or the vault, never hardcoded.
short_description: Run Claude Code on remote hosts over SSH.
short_description_zh: 在远程主机上通过 SSH 运行 Claude Code（持久会话 / headless / tmux 交互 / 多轮续接）。
preinstall: false
version: 1
updated: 2026-08-10T00:00:00Z
---

# Remote Claude Code

Drive Claude Code on a remote Linux host over SSH. Three modes, in increasing interactivity:

1. **Persistent SSH session** — one long-lived expect-driven connection you keep feeding commands across turns.
2. **Headless (`claude -p`)** — one-shot or scripted calls, with the stdin fix that naive invocations need.
3. **Interactive TUI** — the real Claude Code UI inside a remote `tmux` session, driven with `tmux send-keys` / `tmux capture-pane`. tmux is the way to do interactive use.

Reach for this skill when the user wants to run or drive Claude Code on a server, keep an SSH connection open across turns, or hold a continuous conversation with Claude Code on a remote box.

## Before you start

If the user's message only invokes this skill without a concrete task, ask what they want — at minimum the remote host, the SSH user, and what Claude Code should do there.

Credential rules — non-negotiable:

- This document contains **no real credentials**: `<ssh-user>`, `<remote-host>`, `<target-user>`, `<sess>` are placeholders you substitute at runtime from what the user provides or from this agent's **key vault** (suggested keys: `REMOTE_SSH_HOST`, `REMOTE_SSH_USER`, `REMOTE_SSH_PASSWORD`). Vault values reach your shell environment on the next task — check with `[ -n "$REMOTE_SSH_PASSWORD" ] && echo ok || echo missing`, and if missing ask the user to add the keys to the key vault (gear icon on the agent card → settings → key vault tab) or to provide the values in chat.
- **Never hardcode a password** into scripts left on disk, deliverables, or your final answer. Have expect read it from the environment (`$env(...)`); if the user pasted it in chat, export it only into the running process's environment, scrub it from logs and replies, and delete any temp file that embeds it as soon as the session is done.
- Prefer SSH keys when they are already set up — then no password tooling is needed at all.
- Back up remote config before modifying it, and never copy remote credential stores (`~/.claude/.credentials.json`, OAuth fields of `~/.claude.json`, private keys) anywhere.

## 1. Persistent SSH session (expect)

One long-lived connection with password auto-login and an optional user switch, held open by `interact`. `expect` ships with macOS and is a one-command install on Linux; `sshpass` is usually absent, so expect is the password-interactive tool of choice.

The full expect template plus its operating notes live in [`reference/persistent-session.md`](reference/persistent-session.md) — read that file when setting up this mode. In short: write the template to your scratchpad, fill the placeholders at runtime (the password comes from `$env(REMOTE_SSH_PASSWORD)`, never hardcoded), start it with `exec_command`, and drive the held-open connection through its `process_id` with `input_command`. Reuse this one session for most remote commands rather than opening a new connection each time.

## 2. Headless Claude Code (`claude -p`) — the stdin gotcha

`claude -p "<prompt>"` hangs forever when its stdin is an open pipe that never closes — which is exactly what agent harnesses and the expect session above provide. The process idles with no output and no network connections. Fix: redirect stdin from `/dev/null`:

```bash
claude -p "Reply with exactly: all good" < /dev/null
```

Same for `--resume`, `--session-id`, `--output-format stream-json`, and the rest. Exception: when input is _meant_ to come from stdin (`--input-format stream-json`), feed it through a pipe that closes (`echo '<json>' | claude ...`) and do **not** add `< /dev/null` — that would override the pipe.

Symptom checklist: process running + no output + no TCP connections → stdin starvation; add `< /dev/null`.

## 3. Interactive TUI — tmux is the way

Launching `claude` interactively inside the expect/pipe session renders the welcome screen, but pipe input is treated as a **paste**: text lands in the input box and Enter (`\r`) is inserted literally, so the message is never submitted (the remote transcript `~/.claude/projects/<dir>/*.jsonl` gains no user entry). Run Claude Code inside a remote `tmux` session instead and drive it with `tmux send-keys`, which delivers discrete keypresses:

```bash
# start detached, then read the screen
TERM=xterm-256color tmux new-session -d -s <sess> "claude"
sleep 8
tmux capture-pane -t <sess> -p | tail -25

# converse: send a message, wait for the turn, read the screen again
tmux send-keys -t <sess> "Introduce yourself in one sentence" Enter
sleep 20
tmux capture-pane -t <sess> -p | tail -30
```

- Workspace trust dialog: it shows on the first launch in each project directory (`-p` mode skips it; `--dangerously-skip-permissions` does **not**). Answer it once via `tmux send-keys -t <sess> Enter`, or pre-accept it by setting `hasTrustDialogAccepted: true` for that project path in the remote `~/.claude.json` — back the file up first (`cp ~/.claude.json ~/.claude.json.bak-$(date +%s)`) and rewrite it with a JSON-aware tool (python), not sed.
- Tool-permission prompts: answer them through `send-keys` as they appear; launch with `--dangerously-skip-permissions` only when the user explicitly wants unattended runs on that host.
- `TERM=xterm-256color` must be visible to the tmux **server** (prefix the `tmux new-session` call that starts it), or the TUI renders garbled and colorless.
- Continuity is real: within one tmux session, follow-ups remember earlier turns ("what was my first question?" gets the right answer).
- The user can join from their own terminal at any time: `ssh <ssh-user>@<remote-host>` → `su - <target-user>` → `tmux attach -t <sess>`.

## 4. Continuous (multi-turn) conversation

Three verified ways to keep context across calls:

**a) Same session across headless invocations (simplest):**

```bash
SID=$(uuidgen)
claude -p "Remember: my name is Alex." --session-id "$SID" < /dev/null
claude -p "What is my name?" --resume "$SID" < /dev/null   # answers: Alex
```

**b) stream-json real-time protocol (programmatic):**

```bash
echo '{"type":"user","message":{"role":"user","content":"Hello"}}' \
  | claude -p --verbose --input-format stream-json --output-format stream-json
```

Returns `system/init` (carrying the `session_id`), `assistant`, and `result` events; reuse the `session_id` to continue. `--output-format stream-json` requires `--verbose`.

**c) The interactive tmux session (section 3)** — the true REPL-style continuous conversation.

## 5. Troubleshooting

| Symptom                                                     | Cause / fix                                                                                          |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `claude -p` runs forever, no output, no TCP connections     | stdin pipe never closes → add `< /dev/null`                                                          |
| TUI renders once then ignores keys; Enter shows up literally | pipe input treated as a paste → drive it with tmux `send-keys`                                       |
| Trust dialog on every launch                                | `hasTrustDialogAccepted` unset for that project dir → set it to true (back up `~/.claude.json` first) |
| TUI garbled / no colors                                     | `TERM=dumb` → set `xterm-256color` at expect spawn or tmux launch                                    |
| expect stuck producing no output                            | a prompt regex never matched → replace it with `sleep` + fixed sends                                 |
| `Connection timed out during banner exchange`               | busy server / transient → wait a few seconds and retry; keep one persistent session instead of hammering new ones |
| New SSH connections crawl while old ones work               | connection pressure → route commands through the persistent session                                  |

## 6. Verification checklist

- Persistent session: the probe returns `whoami`/`hostname`/`pwd`, and the prompt comes back after each command.
- Headless: `claude -p "..." < /dev/null` prints the answer and exits.
- Interactive: `capture-pane` shows your message on the input line, then the response, then the prompt again.
- Continuity: a follow-up that requires memory answers correctly (or the remote `~/.claude/projects/**/*.jsonl` shows the user entry).
- Sanitization: no real host, user, or password appears in temp scripts left on disk or in your final answer — real values only ever come from the user or the vault at runtime.
