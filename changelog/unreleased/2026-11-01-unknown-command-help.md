# Help for an unknown command says so and exits nonzero

Date: 2026-11-01
Type: fix
Scope: cli

[中文版](./2026-11-01-unknown-command-help.zh.md)

`penguin <word> --help` used to print the top-level help and exit 0 for any word that named no command, so a typo written behind a help flag looked like a success. An unknown word now produces the same error the bare word produces: `[error] unknown command <word>`, the usage hint pointing at `penguin --help`, and exit 1. The program's own `--help` and the help of every real command are unchanged.
