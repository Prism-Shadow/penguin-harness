---
name: send-music
description: Make a short piece of music as an audio file in the Workspace and send it in your reply as a Markdown link, which the app shows with a player. Use when the user asks you to compose, play, send or "let me hear" a tune, melody, jingle, chime or sound.
version: 2026.10.11.1
---

# Send music

The app draws a player under any paragraph of your reply that links an audio file in the
Workspace (`.wav`, `.mp3`, `.ogg`, `.m4a`). So sending music is two steps: write the file, then
link it. There is no special tool — use the shell you already have.

## 1. Make the file

Write a WAV with Python's standard library. It needs nothing installed and no network. Adapt the
notes, tempo and file name to the request; keep it short (under a minute — a WAV is about 88 KB per
second at these settings).

```bash
mkdir -p music && python3 - <<'PY'
import math, struct, wave

RATE = 44100
# (note, beats); "R" is a rest. Equal temperament from A4 = 440 Hz.
TUNE = [("E4", 1), ("G4", 1), ("A4", 2), ("G4", 1), ("E4", 1), ("D4", 2), ("C4", 4)]
BPM = 96
NAMES = {"C": -9, "D": -7, "E": -5, "F": -4, "G": -2, "A": 0, "B": 2}

def freq(note):
    semis = NAMES[note[0]] + (1 if "#" in note else 0) + 12 * (int(note[-1]) - 4)
    return 440.0 * 2 ** (semis / 12)

frames = bytearray()
for note, beats in TUNE:
    n = int(RATE * beats * 60 / BPM)
    for i in range(n):
        if note == "R":
            sample = 0.0
        else:
            t = i / RATE
            envelope = min(1.0, i / 400) * min(1.0, (n - i) / 2000)  # no clicks at the edges
            tone = math.sin(2 * math.pi * freq(note) * t) + 0.3 * math.sin(4 * math.pi * freq(note) * t)
            sample = 0.4 * envelope * tone
        frames += struct.pack("<h", int(max(-1.0, min(1.0, sample)) * 32767))

with wave.open("music/tune.wav", "wb") as w:
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(RATE)
    w.writeframes(bytes(frames))
PY
```

No Python? The same idea works in Node: compute 16-bit samples into a `Buffer` and prepend the
44-byte RIFF/WAVE header (`fs.writeFileSync`).

Smaller file: if `ffmpeg` is on the PATH (`command -v ffmpeg`), convert and link the mp3 instead:
`ffmpeg -loglevel error -y -i music/tune.wav -b:a 128k music/tune.mp3`. Do not install anything to
get it; WAV is fine.

Check the file exists and is not empty (`ls -l music/`) before you link it.

## 2. Link it in your reply

Write an ordinary Markdown link whose target is the file's path **relative to the Workspace**:

```markdown
Here is a short tune in C major — [Evening Theme](music/tune.wav).
```

- Put the link in a normal sentence, not inside backticks or a code block: text in code is not a
  link, and gets no player.
- One player appears under the paragraph that holds the link, once per file however often you link
  it there. Linking several files in one paragraph shows them in that order.
- No `file://`, no absolute path outside the Workspace, no URL to a website — those are not
  Workspace files.
- Say in words what the piece is (key, mood, length); the reader may not press play.
