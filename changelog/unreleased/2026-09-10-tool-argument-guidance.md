# exec_command accepts `command` for `cmd`, and a rejected call explains how to fix itself

- **Date:** 2026-09-10
- **Type:** fix
- **Scope:** `core`, `web`, `cli`, `docs`

[中文版](2026-09-10-tool-argument-guidance.zh.md)

A model that named the shell text `command` instead of `cmd` — the parameter name of other harnesses' shell tools — had every `exec_command` call rejected with a one-line "missing argument", and typically re-issued the same call unchanged. `exec_command` now runs a call that carries the text as `command` (the schema still declares `cmd` alone, and `cmd` wins when both are present), and every built-in tool that rejects a call for its arguments now answers with a complete correction guide instead of one line.

## Details

- The alias is read through one list shared by the tool, the command policy and the call previews: the policy screens exactly the text the tool runs, and the Web App's and CLI's `$ …` previews — the line the user approves — show it.
- The correction guide names the fault (missing, wrong type, empty, or invalid, and the alias the argument arrived under if any), lists the argument names received and calls out the ones the tool does not declare, restates the tool's parameters from the schema the model was handed (name, type, required or optional, aliases, description), and closes with the shape of a correct call carrying every required parameter. Its closing line repeats the tool and argument names, so the tail the server's error ledger keeps still says what went wrong.
- Covered: `exec_command` (`cmd`), `input_command` (`process_id`), `run_subagent` (`prompt`), `input_subagent` (`subagent_id`), `read_file` (`file_path`, and an unusable `offset` or `limit`), `write_file` (`file_path`, `content`), `edit_file` (`file_path`, `old_string`, `new_string`).
