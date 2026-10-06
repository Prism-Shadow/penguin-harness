/**
 * The disclosure every terminal surface carries: a terminal is the person's own shell, and no
 * Session's permissions reach it. It sits beside the permission control on the Session page (the
 * dock) and on the standalone page the dock hands a shell off to, so "Workspace write" is never
 * shown next to a shell without saying the policy does not cover it.
 */
import { InfoPopover } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";

export function TerminalSandboxNote({ className = "" }: { className?: string }) {
  const label = S.terminal.unsandboxed;
  return (
    <span
      data-testid="terminal-sandbox-note"
      className={`flex shrink-0 items-center gap-1 whitespace-nowrap text-xs ${className}`}
    >
      {label}
      <InfoPopover label={label}>{S.terminal.unsandboxedInfo}</InfoPopover>
    </span>
  );
}
