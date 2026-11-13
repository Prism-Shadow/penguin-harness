/**
 * Factory command-policy rules — the seed data for a new project's `[command_policy]`
 * block, kept next to the other seeded data (default-config.ts):
 * `defaultProjectConfig` copies them into every new project, and the enforcement side
 * reads the same constant as its "absent = factory set" fallback. Data only, no
 * matching — so nothing here can drag the tool chain into the state module.
 *
 * Kept deliberately small. The `deny` entries are commands whose verbatim execution is
 * destructive with no undo, so a false negative is worse than the occasional false
 * positive. The `ask` entries after them are the commonest commands that act beyond this
 * machine and are hard to take back (merging a pull request, publishing, a force-push):
 * they are put to a person rather than refused, so a false positive costs one click. Each
 * pattern assumes the command has been whitespace-normalized (runs collapsed to single
 * spaces) and never crosses a `;`, `|` or `&` separator.
 *
 * Every pattern sticks to syntax that every runtime the server ships on, and every browser
 * the settings page checks a pattern in, compiles: no inline modifier groups (`(?i:…)`, ES2025),
 * no lookbehind, no named groups, no `v`-flag classes. Node 22 and older reject `(?i:…)`, and
 * a factory rule one runtime cannot compile is skipped there (it guards nothing) and makes
 * every save of the list fail. Case-insensitive words are spelled with {@link ci} instead.
 * Descriptions are stored data (project-editable after seeding), so they are plain
 * English like the rest of the config file.
 */
import type { CommandPolicyConfig, CommandPolicyRule } from "../interfaces/index.js";

/**
 * THE single "absent = factory set" fallback: every consumer of the rule list —
 * enforcement (evaluateCommandPolicy), the server's GET, and seeding-adjacent display —
 * resolves it through here, so the fallback semantics cannot fork.
 */
export function effectiveCommandPolicyRules(
  policy?: CommandPolicyConfig,
): readonly CommandPolicyRule[] {
  return policy?.rules ?? DEFAULT_COMMAND_POLICY_RULES;
}

/**
 * Block devices whose overwrite is unrecoverable — shared by the `dd` and shell-redirect
 * factory rules. Deliberately excludes `null` / `zero` / `stdout` and friends:
 * `dd of=/dev/null` is a common benchmarking idiom, not an accident. The trailing
 * `[a-zA-Z0-9]*` is greedy, so the token is already consumed to its end and neither rule
 * needs a boundary assertion after it — which is what lets `of=/dev/sda; sync` match.
 */
const BLOCK_DEVICES = "(?:sd|hd|vd|xvd|nvme|mmcblk|loop|disk|rdisk)[a-zA-Z0-9]*";

/**
 * Command-word prefix: a separator (or the start), then the optional directory part of a
 * path. `/bin/rm` and `/sbin/mkfs.ext4` are ordinary spellings — `mkfs` in particular is
 * usually reached by path — so a rule that only anchors on the bare word misses the plain
 * case, never mind an evasive one.
 */
const CMD_START = "(?:^|[\\s;&|(])(?:[^\\s;&|]*/)?";

/** An operand may be quoted: `of="/dev/sda"` and `> '/dev/sda'` are the same write. */
const QUOTE = "[\"']?";

/**
 * Matches `words` in any letter case without a flag or an inline modifier: each ASCII letter
 * becomes its two-case class and every other character stays as written (`ci("rd")` →
 * `[Rr][Dd]`); several words become one alternation (`ci("force", "f")` →
 * `(?:[Ff][Oo][Rr][Cc][Ee]|[Ff])`). Without the `u` flag an `i` match folds no non-ASCII
 * character onto an ASCII letter, so the classes match exactly what `(?i:…)` did.
 */
function ci(...words: string[]): string {
  const spelled = words.map((word) =>
    word.replace(/[a-zA-Z]/g, (c) => `[${c.toUpperCase()}${c.toLowerCase()}]`),
  );
  return spelled.length === 1 ? spelled[0]! : `(?:${spelled.join("|")})`;
}

/**
 * The raw physical-disk device on Windows (`\\.\PhysicalDrive0`) — what `/dev/sda` is on a
 * POSIX host, and destroyed the same way by a raw write.
 */
const WINDOWS_RAW_DISK = `\\\\\\\\\\.\\\\${ci("physicaldrive")}[0-9]+`;

/**
 * `git` and its global options up to the subcommand: `git -C <dir>` and `git -c <key=value>`
 * take a separate value, every other option is one token (`--no-pager`, `--git-dir=…`).
 */
const GIT = "git(?:\\s+-[Cc]\\s+[^\\s;&|]+|\\s+-[^\\s;&|]+)*";

/** A package manager and its options up to the subcommand (`pnpm -r`, `pnpm --filter <pkg>`). */
const PACKAGE_MANAGER = "(?:npm|pnpm|yarn)(?:\\s+(?:--filter|-F)\\s+[^\\s;&|]+|\\s+-[^\\s;&|]+)*";

export const DEFAULT_COMMAND_POLICY_RULES: readonly CommandPolicyRule[] = [
  {
    name: "rm-recursive-force",
    // `rm` with both a recursive and a force flag anywhere in the same command segment:
    // `-rf`, `-fr`, `-r -f`, `-Rf`, `-rF`, `--recursive --force`, with or without `sudo` or
    // a leading path. The two lookaheads scan the segment independently so flag order and
    // grouping don't matter; each flag token must end at a word break so `-rf` matches but
    // `--red-flag` doesn't.
    pattern: `${CMD_START}rm(?=(?:\\s[^;&|]*)?\\s-(?:[a-zA-Z]*[rR][a-zA-Z]*|-recursive)(?:\\s|$))(?=(?:\\s[^;&|]*)?\\s-(?:[a-zA-Z]*[fF][a-zA-Z]*|-force)(?:\\s|$))`,
    description: "rm with recursive + force flags in one command (rm -rf and friends)",
  },
  {
    name: "mkfs",
    // Formatting a filesystem (`mkfs`, `mkfs.ext4`, `/sbin/mkfs.ext4`, …) destroys the
    // target wholesale. The word itself is the risk signal, so the rule also fires on a
    // file merely named `mkfs.sh` — a false positive the guardrail accepts.
    pattern: `${CMD_START}mkfs(?:\\.[a-zA-Z0-9]+)?(?![a-zA-Z0-9])`,
    description: "mkfs — formatting a filesystem destroys it wholesale",
  },
  {
    name: "dd-to-block-device",
    // `dd` writing straight to a block device. `of=/dev/null` stays legal (see BLOCK_DEVICES).
    pattern: `${CMD_START}dd\\s[^;&|]*\\bof=${QUOTE}/dev/${BLOCK_DEVICES}`,
    description: "dd writing directly to a block device (of=/dev/null stays allowed)",
  },
  {
    name: "fork-bomb",
    // The classic `:(){ :|:& };:` — exhausts the process table in seconds. Bash allows
    // whitespace inside the function definition, so every token boundary takes `\s*`.
    pattern: ":\\s*\\(\\s*\\)\\s*\\{\\s*:\\s*\\|\\s*:\\s*&\\s*\\}\\s*;\\s*:",
    description: "the classic fork bomb — exhausts the process table in seconds",
  },
  {
    name: "overwrite-block-device",
    // Shell redirection onto a block device (`> /dev/sda`); `/dev/null` etc. stay legal.
    pattern: `>\\s*${QUOTE}/dev/${BLOCK_DEVICES}`,
    description: "shell redirection onto a block device (/dev/null stays allowed)",
  },
  // The four below are the Windows counterparts of the five above — no new command classes,
  // just the same destruction spelled for pwsh and cmd, which `shell.ts` will happily resolve.
  // Their command words and switches match in any letter case (spelled with `ci`), because
  // both shells read them that way.
  {
    name: "windows-recursive-delete",
    // PowerShell `Remove-Item … -Recurse … -Force` (order-independent, `-Rec`/`-r`/`-f`
    // abbreviations included) and the cmd forms `rd|rmdir|del|erase … /s … /q`. cmd allows
    // switches to run together (`/s/q`), so each is only required to appear in the segment.
    pattern:
      `${CMD_START}${ci("remove-item")}(?![a-zA-Z0-9])(?=(?:\\s[^;&|]*)?\\s-(?:${ci("rec")}[a-zA-Z]*|${ci("r")})(?:\\s|$))(?=(?:\\s[^;&|]*)?\\s-${ci("force", "f")}(?:\\s|$))` +
      `|${CMD_START}${ci("rmdir", "rd", "del", "erase")}(?![a-zA-Z0-9])(?=[^;&|]*/${ci("s")}(?![a-zA-Z]))(?=[^;&|]*/${ci("q")}(?![a-zA-Z]))`,
    description: "Windows recursive force delete (Remove-Item -Recurse -Force, rd /s /q)",
  },
  {
    name: "windows-format-volume",
    // `format C:` (the drive letter is required, so `pnpm format` is not a hit) and the
    // PowerShell cmdlet.
    pattern:
      `${CMD_START}${ci("format")}(?![a-zA-Z0-9-])(?=[^;&|]*\\s[a-zA-Z]:(?![a-zA-Z0-9]))` +
      `|${CMD_START}${ci("format-volume")}(?![a-zA-Z0-9])`,
    description: "Windows volume format (format C:, Format-Volume) — destroys it wholesale",
  },
  {
    name: "windows-disk-overwrite",
    // A raw write to the physical disk device, and the cmdlet that wipes one.
    pattern: `${WINDOWS_RAW_DISK}|${CMD_START}${ci("clear-disk")}(?![a-zA-Z0-9])`,
    description: "Windows raw disk overwrite (\\\\.\\PhysicalDriveN, Clear-Disk)",
  },
  {
    name: "windows-fork-bomb",
    // The cmd batch fork bomb: a script that pipes itself into itself.
    pattern: "%0\\s*\\|\\s*%0",
    description: "the cmd fork bomb (%0|%0) — exhausts the process table in seconds",
  },
  // The five below ask instead of refusing: each acts beyond this machine and is hard to take
  // back, but is also routine work a person may well want done. A `deny` hit outranks them
  // wherever they sit (see internal/command-policy.ts). Text matching only: the same action
  // through an alias, a script or an API call walks past, and the go-ahead rule in the default
  // prompt's # Tool use covers what they cannot see.
  {
    name: "gh-pr-merge-close",
    pattern: `${CMD_START}gh\\s+pr\\s+(?:merge|close)(?![a-zA-Z0-9-])`,
    description:
      "gh pr merge / close — a pull request is merged or closed only with a person's go-ahead",
    action: "ask",
  },
  {
    name: "gh-release",
    pattern: `${CMD_START}gh\\s+release\\s+(?:create|delete|edit)(?![a-zA-Z0-9-])`,
    description: "gh release create / delete / edit — publishing faces outward",
    action: "ask",
  },
  {
    name: "git-push-force",
    // A force flag anywhere in the push's own segment, `--force-with-lease=<ref>` included.
    pattern: `${CMD_START}${GIT}\\s+push(?=(?:\\s[^;&|]*)?\\s(?:-f|--force|--force-with-lease(?:=[^\\s;&|]*)?)(?:\\s|$))`,
    description: "git push with a force flag rewrites shared history",
    action: "ask",
  },
  {
    name: "git-push-default-branch",
    // `main` or `master` as a push target, alone or as a refspec's destination
    // (`HEAD:main`, `x:refs/heads/main`, `:main`). A bare `git push` names no target, so
    // nothing here can tell where it goes; the prompt covers it.
    pattern: `${CMD_START}${GIT}\\s+push(?=(?:\\s[^;&|]*)?\\s(?:[^\\s;&|:]*:)?(?:refs/heads/)?(?:main|master)(?:\\s|$))`,
    description:
      "git push to main or master (a bare git push cannot be told apart and is left to the prompt)",
    action: "ask",
  },
  {
    name: "package-publish",
    pattern: `${CMD_START}${PACKAGE_MANAGER}\\s+publish(?![a-zA-Z0-9-])`,
    description: "npm / pnpm / yarn publish — a package release faces outward",
    action: "ask",
  },
];
