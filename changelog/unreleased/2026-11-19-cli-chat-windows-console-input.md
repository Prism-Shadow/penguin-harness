# The desktop app's `penguin` reads its prompts from the console on Windows

- **Date:** 2026-11-19
- **Type:** fix
- **Scope:** `cli`, `server`
- **PR:** [#1634](https://github.com/Prism-Shadow/penguin-harness/pull/1634)
- **Issue:** [#1629](https://github.com/Prism-Shadow/penguin-harness/issues/1629)

[中文版](2026-11-19-cli-chat-windows-console-input.zh.md)

On Windows, `penguin chat` run through the desktop app's `penguin` command showed its banner and prompt, then returned to the shell, in cmd and in PowerShell alike. That command runs the CLI on the app's own executable as Node. The executable is a GUI program, so Windows gave it no console input, and Node read the empty stdin as the end of input. The same empty stdin answered every other prompt: `penguin run` denied each tool approval without asking, and `penguin auth login` skipped the account question and ended at the password prompt. In that case every prompt now opens the console's input (`CONIN$`) directly, and keys, raw mode and Ctrl-C work there as in any terminal.

## Details

- Prompts that read the console this way:
  - `penguin chat`;
  - the tool approval of `penguin run` and `penguin session input`;
  - the account and password prompts of `penguin auth login`, where the password stays unechoed;
  - the y/N confirmation of `penguin config lang`;
  - the y/N confirmation of `penguin update`;
  - the script `penguin browser exec -` reads from stdin.

  `penguin config lang` and `penguin update` refuse on Windows before they ask, so their prompts read the console only once those commands run there.
- The CLI reads the console instead only on the desktop runtime (Electron run as Node), and only when stdin is the NUL device or missing. Input from a pipe or a file is read as given. A desktop CLI whose output is captured, such as an Agent's command, has no console to read and keeps its stdin. The `penguin` that `install.ps1` and npm install runs on Node, which always has the console's input.
- The server's `<root>\bin\penguin.cmd`, which the app's terminals and Agents use, runs the same executable, so these prompts work in the app's terminals too.
- A new test runs the built CLI in a real pseudo-terminal (ConPTY on Windows). It types a chat command, answers a `penguin run` approval and signs in with `penguin auth login`, and it checks what reaches the server and that the password is never shown. On Windows the test runs the chat through both launcher shapes, a cmd script that runs Node and one that runs Electron as Node. It runs the approval and the sign-in through the Electron one.
