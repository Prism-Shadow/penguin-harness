# `penguin chat` from the desktop app waits for input on Windows

- **Date:** 2026-11-19
- **Type:** fix
- **Scope:** `cli`
- **Issue:** [#1629](https://github.com/Prism-Shadow/penguin-harness/issues/1629)

[中文版](2026-11-19-cli-chat-windows-console-input.zh.md)

On Windows, `penguin chat` run through the desktop app's `penguin` command showed its banner and prompt, then returned to the shell, in cmd and in PowerShell alike. That command runs the CLI on the app's own executable as Node. The executable is a GUI program, so Windows gave it no console input, and Node read the empty stdin as the end of input. In that case the chat now opens the console's input (`CONIN$`) directly, and keys, raw mode and Ctrl-C work there as in any terminal.

## Details

- The chat reads the console instead only on the desktop runtime (Electron run as Node), and only when stdin is the NUL device or missing. Input from a pipe or a file is read as given. The `penguin` that `install.ps1` and npm install runs on Node, which always has the console's input.
- The server's `<root>\bin\penguin.cmd`, which the app's terminals and Agents use, runs the same executable, so `penguin chat` works there too.
- A new test runs the built CLI in a real pseudo-terminal (ConPTY on Windows), types a command, and checks that the chat answers it and that `/exit` ends it. On Windows it covers both launcher shapes: a cmd script that runs Node, and one that runs Electron as Node.
