/**
 * 状态页: a plugin's page in Settings, from the package — the version element in each state it
 * can stand in (installed, being prepared with and without an amount, failed with Retry, not
 * installed with Install, not supported here, not known), the checklist in its four row states with a row's
 * own action and its folded details, the one "check again" at the list's heading, and a whole
 * status strip with a summary pill and a primary action.
 */
import {
  Button,
  Checklist,
  ChecklistRow,
  InstalledVersion,
  Pill,
  RuledSection,
  StatusStrip,
} from "@prismshadow/penguin-ui";
import type { InstalledVersionState } from "@prismshadow/penguin-ui";
import { BoardGroup } from "../../foundations/shared";
import { useGallery } from "../../state";

/** Names, versions, platforms and a tool's own words are data: the same in both languages. */
const PROGRAM = "agent-desktop";
const VERSION = "1.3.1";
const PLATFORM = "linux-x64";
const TOOL_SAID = "No D-Bus session bus is reachable. Run inside a desktop session.";
const DIR = "/home/ubuntu/.penguin/data/computer-use/bin/1.3.1";

export function StatusBoard() {
  const { S } = useGallery();
  const t = S.library.status;
  const versions: Array<{
    state: InstalledVersionState;
    progress?: number;
    text?: string;
    action?: string;
  }> = [
    { state: "installed" },
    { state: "preparing", progress: 0.4, text: t.downloading },
    { state: "preparing", text: t.verifying },
    { state: "failed", text: t.failedWhy, action: t.retry },
    { state: "missing", action: t.install },
    { state: "unsupported", text: t.unsupportedWhy },
    { state: "unknown" },
  ];
  return (
    <>
      <BoardGroup title={t.versions} aside={t.versionsHint}>
        <div className="space-y-5">
          {versions.map((v, i) => (
            <InstalledVersion
              key={i}
              name={PROGRAM}
              state={v.state}
              stateLabel={t.versionState[v.state]}
              {...(v.state === "installed" || v.state === "failed"
                ? { version: VERSION, platform: PLATFORM }
                : {})}
              {...(v.progress !== undefined ? { progress: v.progress } : {})}
              {...(v.text !== undefined ? { text: v.text } : {})}
              {...(v.state === "installed" ? { details: DIR, detailsLabel: t.details } : {})}
              {...(v.action !== undefined
                ? {
                    action: (
                      <Button size="sm" variant="secondary">
                        {v.action}
                      </Button>
                    ),
                  }
                : {})}
            />
          ))}
        </div>
      </BoardGroup>
      <BoardGroup title={t.checks} aside={t.checksHint}>
        <RuledSection
          title={t.checksTitle}
          level={3}
          actions={
            <Button size="sm" variant="secondary">
              {t.recheck}
            </Button>
          }
        >
          <Checklist label={t.checksTitle}>
            <ChecklistRow
              id="display"
              label={t.display}
              state="ok"
              stateLabel={t.checkState.ok}
              text="X11 :93"
            />
            <ChecklistRow
              id="accessibility"
              label={t.accessibility}
              state="action"
              stateLabel={t.checkState.action}
              text={t.accessibilityText}
              details={TOOL_SAID}
              detailsLabel={t.details}
              action={
                <Button size="sm" variant="secondary">
                  {t.openSettings}
                </Button>
              }
            />
            <ChecklistRow
              id="wm"
              label={t.windowManager}
              state="unknown"
              stateLabel={t.checkState.unknown}
              text={t.windowManagerText}
            />
            <ChecklistRow
              id="automation"
              label={t.automation}
              state="na"
              stateLabel={t.checkState.na}
            />
          </Checklist>
        </RuledSection>
      </BoardGroup>
      <BoardGroup title={t.strip} aside={t.stripHint}>
        <StatusStrip
          status={
            <InstalledVersion
              name={PROGRAM}
              version={VERSION}
              platform={PLATFORM}
              state="installed"
              stateLabel={t.versionState.installed}
            />
          }
          summary={
            <Pill tone="attention" tooltip={t.summaryHint}>
              {t.summary}
            </Pill>
          }
          actions={
            <Button size="sm" variant="secondary">
              {t.exportLogs}
            </Button>
          }
        />
      </BoardGroup>
    </>
  );
}
