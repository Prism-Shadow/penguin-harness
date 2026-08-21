/**
 * Factory command-policy rules — the seed data for a new project's `[command_policy]`
 * block, kept next to the other seeded catalogs (model-catalog.ts, default-config.ts):
 * `defaultProjectConfig` copies them into every new project, and the enforcement side
 * reads the same constant as its "absent = factory set" fallback. Types only, no
 * behavior — so nothing here can drag the tool chain into the state module.
 *
 * Kept deliberately small — every entry is a command whose verbatim execution is
 * destructive with no undo, so a false negative is worse than the occasional false
 * positive. Each pattern assumes the command has been whitespace-normalized (runs
 * collapsed to single spaces) and never crosses a `;`, `|` or `&` separator.
 * Descriptions are stored data (project-editable after seeding), so they are plain
 * English like the rest of the config file.
 */
import type { CommandPolicyConfig, CommandPolicyRule } from "../interfaces.js";

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
 * `dd of=/dev/null` is a common benchmarking idiom, not an accident.
 */
const BLOCK_DEVICES = "(?:sd|hd|vd|xvd|nvme|mmcblk|loop|disk|rdisk)[a-zA-Z0-9]*";

export const DEFAULT_COMMAND_POLICY_RULES: readonly CommandPolicyRule[] = [
  {
    name: "rm-recursive-force",
    // `rm` with both a recursive and a force flag anywhere in the same command segment:
    // `-rf`, `-fr`, `-r -f`, `-Rf`, `--recursive --force`, with or without `sudo`. The two
    // lookaheads scan the segment independently so flag order and grouping don't matter;
    // each flag token must end at a word break so `-rf` matches but `--red-flag` doesn't.
    pattern:
      "(?:^|[\\s;&|(])rm(?=(?:\\s[^;&|]*)?\\s-(?:[a-zA-Z]*[rR][a-zA-Z]*|-recursive)(?:\\s|$))(?=(?:\\s[^;&|]*)?\\s-(?:[a-zA-Z]*f[a-zA-Z]*|-force)(?:\\s|$))",
    description: "rm with recursive + force flags, in any spelling (rm -rf and friends)",
  },
  {
    name: "mkfs",
    // Formatting a filesystem (`mkfs`, `mkfs.ext4`, …) destroys the target wholesale.
    pattern: "(?:^|[\\s;&|(])mkfs(?:\\.[a-zA-Z0-9]+)?(?:\\s|$)",
    description: "mkfs — formatting a filesystem destroys it wholesale",
  },
  {
    name: "dd-to-block-device",
    // `dd` writing straight to a block device. `of=/dev/null` stays legal (see BLOCK_DEVICES).
    pattern: `(?:^|[\\s;&|(])dd\\s[^;&|]*\\bof=/dev/${BLOCK_DEVICES}(?:\\s|$)`,
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
    pattern: `>\\s*/dev/${BLOCK_DEVICES}(?:\\s|$)`,
    description: "shell redirection onto a block device (/dev/null stays allowed)",
  },
];
