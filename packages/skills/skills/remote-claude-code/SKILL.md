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
tmux capture-pane -t <sess> -p | tail -5     # exactly your message on the input line?
tmux send-keys -t <sess> Enter
sleep 20
tmux capture-pane -t <sess> -p -S -200       # scrollback: a long reply overflows the visible pane
```

- Workspace trust dialog: it shows on the first launch in each project directory (`-p` mode skips it; `--dangerously-skip-permissions` does **not**). Answer it once via `tmux send-keys -t <sess> Enter` and capture to confirm it closed, or pre-accept it by setting `hasTrustDialogAccepted: true` for that project path in the remote `~/.claude.json` — back the file up first (`cp ~/.claude.json ~/.claude.json.bak-$(date +%s)`) and rewrite it with a JSON-aware tool (python), not sed.
- Tool-permission prompts, and any other question Claude Code puts to **the user** (clarifying questions, plan approvals): the decision is the user's, not yours. Report the prompt and its options, wait for the user's answer, then send that key (one key, capture-verified, §3.3). Never approve a tool call on the user's behalf — an approved command runs on their host. `--dangerously-skip-permissions` is the one standing approval you may act on, and only when the user explicitly asked for unattended runs on that host.
- `TERM=xterm-256color` must be visible to the tmux **server** (prefix the `tmux new-session` call that starts it), or the TUI renders garbled and colorless.
- Continuity is real: within one tmux session, follow-ups remember earlier turns ("what was my first question?" gets the right answer).
- The user can join from their own terminal at any time: `ssh <ssh-user>@<remote-host>` → `su - <target-user>` → `tmux attach -t <sess>`.
- The session can die under you (host rebooted, `tmux kill-server`, someone closed it). A `capture-pane` that exits non-zero with `can't find pane: <sess>` or `no server running on ...` means exactly that — not a slow TUI, so don't retry keys into it. Confirm with `tmux has-session -t <sess>` (exit 0 alive, 1 gone), tell the user the session is gone, and rebuild it with `claude --continue` in the same working directory to pick the conversation back up. Never start a bare `claude` and keep relaying as if the earlier context were still there.

### 3.1 Waiting out a long turn — don't hold SSH open

A Claude Code turn can run for ten-plus minutes. Instead of keeping an SSH connection open to poll, place a **detached watcher** on the remote (`setsid nohup`, so it outlives the launching SSH session): it polls `tmux capture-pane` every 10s, and once the turn has been idle for 3 consecutive checks — the footer no longer shows `esc to interrupt` — it writes the final screen plus a `DONE` marker (or `TIMEOUT` past a cap). A blocking SSH loop then waits for the marker and returns the final screen, so the tool call effectively hangs until the turn is done. The full watcher script and the wait loop are in [`reference/completion-watcher.md`](reference/completion-watcher.md) — read it when you need this.

### 3.2 Delivering a message — and why input-line text may be a suggestion

When an idle Claude Code TUI shows text on the input line (after `❯`) — above all right after a turn finishes — that is usually a **Claude-generated suggested next message**, not text the user typed and left pending, and a `capture-pane` dump cannot reliably tell the two apart. So never treat post-run input-line text as pending user input: don't submit it, don't report it to the user as their unsent draft, and don't try to clear or edit it. `tmux send-keys` only ever adds new text — it does not edit or "complete" that suggestion, and Enter submits what _you_ sent, not the suggestion. When the next message is due, just send it — new text makes the suggestion disappear on its own.

**A single plain line** goes through `send-keys -l` (literal mode, so punctuation and words like `Enter` aren't parsed as key names). Text and Enter are always separate calls, with a capture in between:

```bash
tmux send-keys -t <sess> -l "Your full message, punctuation and all"
tmux capture-pane -t <sess> -p | tail -5    # exactly your message on the input line?
tmux send-keys -t <sess> Enter
```

**Anything else — multi-line, pasted, long, or punctuation-heavy — goes through the paste buffer**, because `send-keys -l` corrupts exactly the messages a relay must not corrupt (both verified on tmux 3.3a):

- a newline inside the literal text is delivered as **Return**, so a two-line argument submits its first line on its own and leaves the second as a fresh draft — one user message becomes two Claude Code turns;
- a `;` that ends the argument is swallowed by tmux's own command-sequence parser: `-l "ends with semi;"` arrives as `ends with semi`. Characters vanish and nothing reports an error.

Load the text from a **quoted** heredoc (so neither the shell nor tmux re-parses `$`, backticks, quotes or backslashes) and paste it as one block. This uses the paste behavior §3 warns about on purpose: a bracketed paste lands in the input box as a **draft** and does not submit, so the separate `Enter` keypress stays the thing that sends it.

```bash
tmux load-buffer - <<'MSG'
The user's message, exactly as written —
newlines, "quotes", $signs and semicolons; all intact.
MSG
tmux paste-buffer -d -p -t <sess>            # -p bracketed paste (stays a draft), -d drops the buffer after
tmux capture-pane -t <sess> -p | tail -8
tmux send-keys -t <sess> Enter
```

The landed check is **exact, not approximate**: the input line must show your message and nothing else. A large paste may collapse to a `[Pasted text #N +K lines]` placeholder instead of the text — that still counts as landed; check the line count, not the words. Two failures to watch for, both before you press Enter:

- **Merged** — your text sits next to something else on the line. Don't submit: clear the line (`tmux send-keys -t <sess> C-u`), send again, and if it still merges, tell the user rather than submitting a message they didn't write.
- **Already submitted** — the turn started on its own, without your Enter. That pane isn't honoring bracketed paste, so the message went in split across lines. Say so, and deliver the rest one `-l` line at a time rather than pasting again.

Once the input line is right, send Enter, then `capture-pane` again to confirm the turn started.

### 3.3 One keystroke at a time — capture between keys

The TUI processes keys asynchronously, so a batched sequence races it: `tmux send-keys -t <sess> Up s` delivers `s` before the menu has processed `Up`, and `s` acts on the **previous** selection. Two back-to-back `send-keys` calls with no check in between race the same way.

In every menu, picker, or dialog (`/model`, permission prompts, trust dialog), send **one key per `send-keys` call** and verify between keys: send → `capture-pane` → confirm the expected change (highlight moved, dialog opened or closed, value updated) → only then send the next key.

Know where you are going before you start: capture the picker once, read which row is highlighted now and which row you want, count the moves, and step that many times — never press `Up` and hope.

```bash
tmux send-keys -t <sess> Up
tmux capture-pane -t <sess> -p | tail -15   # highlight moved to the intended entry?
tmux send-keys -t <sess> Enter
tmux capture-pane -t <sess> -p | tail -15   # menu closed, new value shown?
```

If the capture doesn't show the change yet, wait a second and capture again — never fire the next key on faith. Re-capture up to three times (a few seconds in total), then act on what the screen actually shows instead of sending more keys blindly:

- **Nothing changed** — the key was swallowed: re-send that same key once, and verify again.
- **The wrong thing changed** — highlight moved the other way, a different dialog opened, a value flipped that you didn't touch: correct it with the opposite key (`Down` for a stray `Up`, `Escape` for a dialog you didn't want) and verify again. Never "fix" a wrong state by pressing on toward the goal.
- **Still not where you want it after two corrections** — stop. Show the user the captured screen and ask. A menu whose state you can't read is not something to improvise more keystrokes into: a wrong key in `/model` changes their model, and a wrong key in a permission prompt runs a command on their host.

Message text is the one exception to one-key-at-a-time: send the whole message in a single call (`-l` for one plain line, `load-buffer`/`paste-buffer` otherwise), confirm it sits on the input line, then Enter as its own keypress (§3.2).

### 3.4 Model and thinking level are two separate settings

A switch request that names a model **plus a level word** — "switch to fable5 max", "use opus high", "切换到 fable5 max" — means **two** settings: switch the **model** to the named one (Fable 5) **and** the **thinking level** to the named level (max). Never read the pair as one unknown model name, and never forward it as chat text for Claude Code to answer — it is session control you execute in the TUI (section 4).

The rule is about the shape of the request, not about those three examples. It fires on **any** message naming a model, a thinking level, or both, in any language — "换成 opus 高", "改成 max", "set thinking to high", "用 sonnet":

- **Level words** are `max`, `high`, `medium`/`med`, `low`, `none`/`off` and their Chinese equivalents (`最高`/`最大`, `高`, `中`/`中等`, `低`, `关`/`不思考`). A level word sitting next to a model name is always the thinking level — never part of the model's name.
- **Model + level** ("fable5 max") → set both, model first.
- **Level only** ("改成 max", "set thinking to high") → change the thinking level, leave the model alone.
- **Model only** ("switch to opus", "用 sonnet") → change the model, leave the level alone.
- Names arrive shortened, unspaced, or in the wrong case (`fable5` → Fable 5, `opus` → the Opus entry). Match them against the rows the picker actually shows; if nothing matches, say what the picker offers and ask — never pick the nearest-looking row.

Use Claude Code's own controls: type `/model` (`-l`, then Enter as its own key) and walk the picker one keystroke at a time per §3.3; when the build exposes the thinking level as its own entry or toggle rather than a per-model variant, set it in a second step the same way. Finish with a capture that shows **both** the new model and the new thinking level before telling the user the switch is done — for a level-only or model-only request, that the requested one changed **and** the other did not.

## 4. Relaying a conversation — the user's words go through verbatim

Once the session is up and the user is talking to Claude Code **through** you, you are a message pipe — nothing more:

- Forward every user message to Claude Code **verbatim**: the exact wording, unchanged — no answering it yourself, no rephrasing or translating, no summarizing, no doing any part of the task locally. Even when you know the answer or the task looks trivial: the user is talking to Claude Code, not to you.
- Deliver the message (§3.2), wait out the turn (§3.1), then report what Claude Code said — faithfully, without your own analysis, edits, or additions. Read the reply with scrollback (`capture-pane -p -S -200`), not `| tail -30`: a long answer runs off the visible pane and a tail hands the user a fragment presented as the whole reply.
- **Questions travel back, not to you.** When Claude Code asks something — a permission prompt, a clarifying question, a plan to approve — carry it to the user with its options and send the answer they give (§3.3). You never answer on their behalf; that is their conversation.
- **A message that arrives mid-turn waits.** If the footer still shows `esc to interrupt`, don't type into the running turn: hold the message, wait the turn out (§3.1), deliver it then, and tell the user it is queued behind the current run. If they clearly want to stop or redirect now ("stop", "停", "别做了"), send `Escape` as its own key, capture to confirm the working footer is gone, then deliver. Escape twice in a row is not a stronger interrupt — it opens Claude Code's rewind-to-an-earlier-message UI, so send one and check.
- The only requests you act on yourself are **session control**: model / thinking-level switches (§3.4), interrupting a stuck turn (Escape), attaching, detaching, or closing the session, and connection repair. Execute those against the TUI; everything else goes into the conversation verbatim.
- **Split by subject, not by phrasing.** Questions about the **session** — is it still running, what's on the screen, is the connection alive, did the turn finish — you answer yourself from a capture. Anything about the **work** goes through unchanged, including questions you could answer. A message that does both ("is it still going? when it's done have it add the tests too") goes to Claude Code in full, and you answer the session half locally.
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
| User asks for "fable5 max" / "opus high" / "改成 max"        | model and/or thinking level — session control in the TUI (§3.4), not one unknown model, not a chat message to relay |
| Relayed message arrived split in two, or lost its last character | `send-keys -l` delivered an embedded newline as Return, or tmux ate a trailing `;` → deliver anything non-trivial with `load-buffer` + `paste-buffer -d -p` (§3.2) |
| `capture-pane` fails: `can't find pane` / `no server running` | the tmux session or server is gone → confirm with `tmux has-session -t <sess>`, tell the user, rebuild with `claude --continue`; never keep relaying into a fresh, context-less session (§3) |
| Menu key does nothing, or moves the wrong way               | key swallowed or landed on the wrong row → re-send once / correct with the opposite key, verify; after two failed corrections stop and show the user the screen (§3.3) |
| User sends a new message while a turn is running            | don't type into a live turn → hold it until the turn ends (§3.1), or `Escape` once (never twice) if they want to stop now (§4) |
| Want to wait out a long turn without holding SSH open       | run a detached watcher on the remote (see §3.1) that polls `capture-pane` until idle and writes a `DONE`/`TIMEOUT` marker, then block on an SSH loop until it appears |

## 7. Verification checklist

- Persistent session: the probe returns `whoami`/`hostname`/`pwd`, and the prompt comes back after each command.
- Headless: `claude -p "..." < /dev/null` prints the answer and exits.
- Interactive: `capture-pane` shows your message on the input line, then the response, then the prompt again.
- Relay: what reached Claude Code's input line is word-for-word what the user sent — nothing merged in from a suggestion, no line split off, no character dropped — and the reply you report back is Claude Code's, read with scrollback so it isn't a truncated tail.
- Decisions: every permission prompt and question Claude Code raised was answered by the user, not by you.
- Menus: every keystroke was its own `send-keys` call, and a capture confirmed the expected state before the next key.
- Switches: after a model and/or thinking-level request, one final capture shows the requested value(s) changed and the untouched one unchanged.
- Continuity: a follow-up that requires memory answers correctly (or the remote `~/.claude/projects/**/*.jsonl` shows the user entry).
- Sanitization: no real host, user, or password appears in temp scripts left on disk or in your final answer — real values only ever come from the user or the vault at runtime.
