# The Claude Code surface finds `claude` where its installer put it

- **Date:** 2026-09-07
- **Type:** fix
- **Scope:** `plugins`

[中文版](2026-09-07-claude-code-finds-its-program.zh.md)

Opening a Claude Code session on a machine failed with `execvp(3) failed.: No such file or directory` — about a program that was installed and on the operator's own PATH.

The cause is how a machine's server starts, not anything about the tool: it is launched over a **non-interactive ssh**, whose PATH is `/usr/local/bin:/usr/bin:/bin` and nothing else. No profile is read, so `~/.local/bin` — where Claude Code's installer puts it — is not on it, and the pty inherits that PATH.

The surface now resolves the program before spawning: `PENGUIN_CLAUDE_BIN` if set, then PATH, then the places the installer uses (`~/.local/bin`, `~/.claude/local`, and the two package managers people run it under). PATH still wins over the fallbacks, since that is the one an operator's own shell would run.

When there is genuinely nothing to run, the open is refused before a pty is spawned, with a message naming every place that was searched and the variable that overrides the search — instead of the C library's answer about a name it was never told the meaning of.

## …and a push now reaches the plugins it ships

Found while verifying the above on a machine: the fixed plugin arrived in the pushed assets and the old one kept running. The plugin host reuses what an earlier App imported so module identity survives a swap — but it was matching on the specifier alone, and a push writes the builtin plugins to a **new assets directory**. An entry held from before the push therefore kept the previous build's code, forever.

Reuse now requires the specifier to still resolve to the **same file**. Different file, different code: it is imported again.
