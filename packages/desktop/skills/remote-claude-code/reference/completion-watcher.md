# Waiting out a long turn — remote completion watcher

A single Claude Code turn can run for ten-plus minutes. Rather than hold an SSH connection open
polling `tmux capture-pane`, place a **detached watcher** on the remote (`setsid nohup`, so it
outlives the SSH session that launched it). It polls the pane every 10s and, once the turn has been
idle for 3 consecutive checks — the footer no longer shows the working indicator `esc to interrupt`
(rendered as e.g. `✳ Cultivating… (esc to interrupt)` while a turn runs) — writes the final screen
to a file with a `DONE` marker; past a hard cap it writes `TIMEOUT` instead. A blocking SSH loop
then waits for the marker and returns the final screen, so the tool call "hangs until done".

Replace `<sess>` with your tmux session name. `esc to interrupt` is the stable part of the working
footer; the gerunds (`Cultivating`, `Improvising`, …) are flavor text that varies by version, so
key detection on `esc to interrupt` and treat the rest as backup.

## 1. Install and start the watcher (detached)

```bash
ssh <ssh-user>@<remote-host> 'cat > ~/cc-watch.sh <<'"'"'EOF'"'"'
#!/usr/bin/env bash
LOG=~/cc-watch.log; OUT=~/cc-final.txt
rm -f "$LOG" "$OUT"
busy_seen=0; idle_count=0; max_wait=7200; start=$(date +%s)
echo "WATCHER START $(date)" >> "$LOG"
while :; do
  now=$(date +%s)
  if (( now - start > max_wait )); then
    tmux capture-pane -t <sess> -p > "$OUT"; echo "TIMEOUT $(date)" >> "$LOG"; exit 0
  fi
  live=$(tmux capture-pane -t <sess> -p 2>/dev/null | tail -30)
  if printf "%s\n" "$live" | grep -qE "esc to interrupt|Cultivating|Improvising|Running "; then
    busy_seen=1; idle_count=0
  elif [ "$busy_seen" = 1 ]; then
    idle_count=$((idle_count+1))
    if [ "$idle_count" -ge 3 ]; then
      tmux capture-pane -t <sess> -p > "$OUT"; echo "DONE $(date) after $(( now - start ))s" >> "$LOG"; exit 0
    fi
  fi
  sleep 10
done
EOF
chmod +x ~/cc-watch.sh
setsid nohup bash ~/cc-watch.sh >/dev/null 2>&1 < /dev/null &
sleep 2; ps aux | grep -v grep | grep cc-watch.sh'
```

## 2. Block until the marker appears, then return the final screen

```bash
ssh <ssh-user>@<remote-host> '
for i in $(seq 1 900); do
  if grep -qE "DONE|TIMEOUT" ~/cc-watch.log 2>/dev/null; then
    echo "=== WATCHER LOG ==="; cat ~/cc-watch.log
    echo; echo "=== FINAL CAPTURE ==="; cat ~/cc-final.txt 2>/dev/null
    exit 0
  fi
  sleep 10
done'
```

If the blocking loop times out before the marker appears, run it again (or, on a persistent
session, poll again with `input_command`) — the watcher keeps running on the remote regardless.

## Notes

- `tail -30` inspects only the live bottom region of the pane, so an old `Cultivating` line scrolled
  up into history can't be misread as "still busy".
- Requiring 3 consecutive idle checks avoids a false "done" during a brief pause between tool calls
  within one turn.
- The user can read the result themselves at any time: `cat ~/cc-final.txt`.
