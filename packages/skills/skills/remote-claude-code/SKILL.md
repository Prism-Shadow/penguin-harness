---
name: remote-claude-code
description: Run Claude Code on a remote host over SSH — a persistent expect-driven login session, headless claude -p with the stdin fix, the interactive TUI inside a remote tmux driven by send-keys/capture-pane (one keystroke at a time, capture-verified; relayed user messages go through verbatim), and multi-turn continuity via --session-id/--resume or stream-json; hosts and credentials are placeholders resolved at runtime from the user or the vault, never hardcoded.
short_description: Run Claude Code on remote hosts over SSH.
short_description_zh: 在远程主机上通过 SSH 运行 Claude Code（持久会话 / headless / tmux 交互 / 多轮续接）。
preinstall: false
version: 2
updated: 2026-08-18T00:00:00Z
---

# Remote Claude Code

Drive Claude Code on a remote Linux host over SSH. Three modes, in increasing interactivity:

1. **Persistent SSH session** — one long-lived expect-driven connection you keep feeding commands across turns.
2. **Headless (`claude -p`)** — one-shot or scripted calls, with the stdin fix that naive invocations need.
3. **Interactive TUI** — the real Claude Code UI inside a remote `tmux` session, driven with `tmux send-keys` / `tmux capture-pane`. tmux is the way to do interactive use.

Reach for this skill when the user wants to run or drive Claude Code on a server, keep an SSH connection open across turns, or hold a continuous conversation with Claude Code on a remote box. In a relayed conversation you are a pure message pipe — the user's words go to Claude Code verbatim (section 4).

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

# converse: type the message, confirm it landed, submit — text and Enter as separate calls (§3.3)
tmux send-keys -t <sess> -l "Introduce yourself in one sentence"
tmux capture-pane -t <sess> -p | tail -5     # the text sits on the input line?
tmux send-keys -t <sess> Enter
sleep 20
tmux capture-pane -t <sess> -p | tail -30
```

- Workspace trust dialog: it shows on the first launch in each project directory (`-p` mode skips it; `--dangerously-skip-permissions` does **not**). Answer it once via `tmux send-keys -t <sess> Enter`, or pre-accept it by setting `hasTrustDialogAccepted: true` for that project path in the remote `~/.claude.json` — back the file up first (`cp ~/.claude.json ~/.claude.json.bak-$(date +%s)`) and rewrite it with a JSON-aware tool (python), not sed.
- Tool-permission prompts: answer them through `send-keys` as they appear; launch with `--dangerously-skip-permissions` only when the user explicitly wants unattended runs on that host.
- `TERM=xterm-256color` must be visible to the tmux **server** (prefix the `tmux new-session` call that starts it), or the TUI renders garbled and colorless.
- Continuity is real: within one tmux session, follow-ups remember earlier turns ("what was my first question?" gets the right answer).
- The user can join from their own terminal at any time: `ssh <ssh-user>@<remote-host>` → `su - <target-user>` → `tmux attach -t <sess>`.

### 3.1 Waiting out a long turn — don't hold SSH open

A Claude Code turn can run for ten-plus minutes. Instead of keeping an SSH connection open to poll, place a **detached watcher** on the remote (`setsid nohup`, so it outlives the launching SSH session): it polls `tmux capture-pane` every 10s, and once the turn has been idle for 3 consecutive checks — the footer no longer shows `esc to interrupt` — it writes the final screen plus a `DONE` marker (or `TIMEOUT` past a cap). A blocking SSH loop then waits for the marker and returns the final screen, so the tool call effectively hangs until the turn is done. The full watcher script and the wait loop are in [`reference/completion-watcher.md`](reference/completion-watcher.md) — read it when you need this.

### 3.2 Input-line text may be a suggestion, not real input

When an idle Claude Code TUI shows text on the input line (after `❯`) — above all right after a turn finishes — that is usually a **Claude-generated suggested next message**, not text the user typed and left pending, and a `capture-pane` dump cannot reliably tell the two apart. So never treat post-run input-line text as pending user input: don't submit it, don't report it to the user as their unsent draft, and don't try to clear or edit it. `tmux send-keys` only ever adds new text — it does not edit or "complete" that suggestion, and Enter submits what _you_ sent, not the suggestion. When the next message is due, just send it — new text makes the suggestion disappear on its own. Send arbitrary message text literally with `-l` (so punctuation and words like `Enter` aren't parsed as key names), confirm it landed, then send Enter as its own keypress:

```bash
tmux send-keys -t <sess> -l "Your full message, punctuation and all"
tmux capture-pane -t <sess> -p | tail -5    # the text is on the input line?
tmux send-keys -t <sess> Enter
```

Then `capture-pane` again to confirm the turn started.

### 3.3 One keystroke at a time — capture between keys

The TUI processes keys asynchronously, so a batched sequence races it: `tmux send-keys -t <sess> Up s` delivers `s` before the menu has processed `Up`, and `s` acts on the **previous** selection. Two back-to-back `send-keys` calls with no check in between race the same way.

In every menu, picker, or dialog (`/model`, permission prompts, trust dialog), send **one key per `send-keys` call** and verify between keys: send → `capture-pane` → confirm the expected change (highlight moved, dialog opened or closed, value updated) → only then send the next key.

```bash
tmux send-keys -t <sess> Up
tmux capture-pane -t <sess> -p | tail -15   # highlight moved to the intended entry?
tmux send-keys -t <sess> Enter
tmux capture-pane -t <sess> -p | tail -15   # menu closed, new value shown?
```

If the capture doesn't show the change yet, wait a second and capture again — never fire the next key on faith. Message text is the one exception: send the whole message as a single `-l` call, confirm it sits on the input line, then Enter as its own keypress (§3.2).

### 3.4 "switch to fable5 max" — model and thinking level are two settings

A switch request that names a model **plus a level word** — "switch to fable5 max", "use opus high" — means **two** settings: switch the **model** to the named one (Fable 5) **and** the **thinking level** to the named level (max). Never read the pair as one unknown model name, and never forward it as chat text for Claude Code to answer — it is session control you execute in the TUI (section 4).

Use Claude Code's own controls: type `/model` (`-l`, then Enter as its own key) and walk the picker one keystroke at a time per §3.3; when the build exposes the thinking level as its own entry or toggle rather than a per-model variant, set it in a second step the same way. Finish with a capture that shows **both** the new model and the new thinking level before telling the user the switch is done.

## 4. Relaying a conversation — the user's words go through verbatim

Once the session is up and the user is talking to Claude Code **through** you, you are a message pipe — nothing more:

- Forward every user message to Claude Code **verbatim**: the exact wording, unchanged — no answering it yourself, no rephrasing or translating, no summarizing, no doing any part of the task locally. Even when you know the answer or the task looks trivial: the user is talking to Claude Code, not to you.
- Deliver the message (§3.2), wait out the turn (§3.1), then report what Claude Code said — faithfully, without your own analysis, edits, or additions.
- The only requests you act on yourself are **session control**: model / thinking-level switches (§3.4), interrupting a stuck turn (Escape), attaching, detaching, or closing the session, and connection repair. Execute those against the TUI; everything else goes into the conversation verbatim.
- When in doubt whether a message is task or control, relay it verbatim — a mis-relayed control request is easy to recover; work silently done in Claude Code's place is not.

## 5. Continuous (multi-turn) conversation

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

## 6. Troubleshooting

| Symptom                                                     | Cause / fix                                                                                          |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `claude -p` runs forever, no output, no TCP connections     | stdin pipe never closes → add `< /dev/null`                                                          |
| TUI renders once then ignores keys; Enter shows up literally | pipe input treated as a paste → drive it with tmux `send-keys`                                       |
| Trust dialog on every launch                                | `hasTrustDialogAccepted` unset for that project dir → set it to true (back up `~/.claude.json` first) |
| TUI garbled / no colors                                     | `TERM=dumb` → set `xterm-256color` at expect spawn or tmux launch                                    |
| expect stuck producing no output                            | a prompt regex never matched → replace it with `sleep` + fixed sends                                 |
| `Connection timed out during banner exchange`               | busy server / transient → wait a few seconds and retry; keep one persistent session instead of hammering new ones |
| New SSH connections crawl while old ones work               | connection pressure → route commands through the persistent session                                  |
| Input line shows text you didn't type                       | a Claude Code suggestion, common right after a turn ends — not pending user input (see §3.2) → don't submit or edit it; `send-keys -l "<message>"` then `Enter` |
| Menu key acts on the wrong item (`Up` and `s` sent together) | keys batched faster than the TUI processes them → one key per `send-keys` call, `capture-pane` between keys (§3.3) |
| User asks for "fable5 max" / "opus high"                    | model **and** thinking level — two switches in the TUI (§3.4), not one unknown model, not a chat message to relay |
| Want to wait out a long turn without holding SSH open       | run a detached watcher on the remote (see §3.1) that polls `capture-pane` until idle and writes a `DONE`/`TIMEOUT` marker, then block on an SSH loop until it appears |

## 7. Verification checklist

- Persistent session: the probe returns `whoami`/`hostname`/`pwd`, and the prompt comes back after each command.
- Headless: `claude -p "..." < /dev/null` prints the answer and exits.
- Interactive: `capture-pane` shows your message on the input line, then the response, then the prompt again.
- Relay: what reached Claude Code's input line is word-for-word what the user sent, and the reply you report back is Claude Code's, not yours.
- Menus: every keystroke was its own `send-keys` call, and a capture confirmed the expected state before the next key.
- Switches: after a model + thinking-level request, one final capture shows both new values.
- Continuity: a follow-up that requires memory answers correctly (or the remote `~/.claude/projects/**/*.jsonl` shows the user entry).
- Sanitization: no real host, user, or password appears in temp scripts left on disk or in your final answer — real values only ever come from the user or the vault at runtime.
