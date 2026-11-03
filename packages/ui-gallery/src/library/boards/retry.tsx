/**
 * 重试: the retry row a machine shows while the server brings it back — in its phases at a card's
 * size and at body size, inside a machine card beside a running one, and at phone width; a model
 * request's retry and failure in a conversation, each a line of text in the stop marker's shape
 * (waiting with its live countdown, going out, sent, given up, stopped, a fatal error, earlier
 * messages that failed to load), every press a bracketed text action; the failure details dialog
 * the lines' Details opens; and the "could not load" notice a pane shows in place of its content,
 * with the machine's row inside it while it is being brought back. The wait counts down live, and
 * a press holds its actions until the board starts the next attempt.
 */
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { DEFAULT_MAX_TURN_ATTEMPTS } from "@prismshadow/penguin-core/interfaces";
import {
  Button,
  CountdownText,
  ICONS,
  LoadFailed,
  MachineCard,
  MachineList,
  MessageBubble,
  ReportDialog,
  RetryActions,
  RetryStatus,
  TextAction,
  buttonClass,
  useCountdown,
} from "@prismshadow/penguin-ui";
import type { MachineCardProps, RetryStatusProps } from "@prismshadow/penguin-ui";
import { BoardGroup } from "../../foundations/shared";
import { useGallery } from "../../state";

const ROOT = "/home/ubuntu/.penguin/data";
const VERSION = "v0.2.16";
/** The wait the demo's countdown runs; pressing Retry now starts it over, as a new attempt would. */
const WAIT_MS = 40_000;
const MAX = 5;

/** A report as the failure details show it: English whatever the interface's language. */
const REPORT = `### PenguinHarness model request failure

- What happened: 6 attempts failed (at most 10), and the run ended
- Error code: network (status retryable)
- HTTP status: 503
- Provider: anthropic
- Model: claude-sonnet-4-5
- Request ID: req_011CUz3tF8eJ2dQx6Q9pY7Ln
- Time (UTC): 2026-11-02T08:41:13Z
- PenguinHarness: v0.2.18
- Installed as: Desktop app
- OS: macOS (arm64)

Provider message:

\`\`\`text
503 {"type":"error","error":{"type":"overloaded_error","message":"upstream connect error or disconnect/reset before headers. reset reason: overflow"},"request_id":"req_011CUz3tF8eJ2dQx6Q9pY7Ln"}
\`\`\``;

const ISSUE_FORM =
  "https://github.com/Prism-Shadow/penguin-harness/issues/new?template=bug_report.yml";

/** A wait that counts down and starts over: each press of Retry now is the next attempt. */
function useDemoWait() {
  const [attempt, setAttempt] = useState(3);
  const [nextAt, setNextAt] = useState(() => Date.now() + WAIT_MS);
  // The moment passes: the board's next attempt "fails" and waits again, so the line keeps living.
  useEffect(() => {
    const id = setTimeout(
      () => setNextAt(Date.now() + WAIT_MS),
      Math.max(0, nextAt - Date.now()) + 1_500,
    );
    return () => clearTimeout(id);
  }, [nextAt]);
  const retryNow = () => {
    setAttempt((n) => Math.min(n + 1, MAX - 1));
    setNextAt(Date.now() + WAIT_MS);
  };
  return { attempt, nextAt, retryNow };
}

/** One of the conversation's lines, as the chat draws it: the notice, its presses after it. */
function Line({
  phase,
  children,
  actions,
}: {
  phase?: string;
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div role="status" data-retry-phase={phase}>
      <MessageBubble variant="notice" actions={actions}>
        {children}
      </MessageBubble>
    </div>
  );
}

export function RetryBoard() {
  const { S } = useGallery();
  const t = S.library.retry;
  const wait = useDemoWait();
  const [reportOpen, setReportOpen] = useState(false);
  const left = useCountdown(wait.nextAt);
  const phases = (size: "xs" | "sm"): RetryStatusProps[] => [
    {
      phase: "trying",
      label: t.trying(4, MAX),
      reason: t.refused("mini"),
      secondary: { label: t.stop, onClick: noop },
      size,
    },
    {
      phase: "waiting",
      label: t.trying(wait.attempt + 1, MAX),
      countdown: (s) => t.waiting(s, wait.attempt + 1, MAX),
      nextAt: wait.nextAt,
      reason: t.refused("mini"),
      retry: { label: t.retryNow, onClick: wait.retryNow },
      secondary: { label: t.stop, onClick: noop },
      size,
    },
    {
      phase: "gaveUp",
      label: t.gaveUp(MAX),
      reason: t.refused("edge-1"),
      retry: { label: t.retry, onClick: noop },
      size,
    },
    {
      phase: "cancelled",
      label: t.cancelled,
      reason: t.refused("mini"),
      retry: { label: t.retry, onClick: noop },
      size,
    },
    {
      phase: "blocked",
      label: t.stoppedSsh,
      reason: t.hostKey,
      retry: { label: t.retry, onClick: noop },
      size,
    },
    { phase: "blocked", label: t.stoppedPassword, reason: t.password, size },
  ];
  const facts = [
    { glyph: ICONS.terminalPrompt, value: "ssh" },
    { glyph: ICONS.hardDrive, value: VERSION },
    { glyph: ICONS.clock, value: t.card.checked },
  ];
  const card = (id: string, over: Partial<MachineCardProps>): MachineCardProps => ({
    id,
    alias: id,
    status: { state: "reconnecting", label: t.states.reconnecting },
    root: ROOT,
    facts,
    onOpen: noop,
    use: { label: t.card.use, disabled: true, onClick: noop },
    settingsLabel: t.card.settings,
    remove: { label: t.card.remove, onClick: noop },
    ...over,
  });
  const lines = phases("xs");
  const cards: MachineCardProps[] = [
    card("gpu-a100", {
      status: { state: "ready", label: t.states.ready },
      facts: [...facts, { glyph: ICONS.network, value: "7364" }],
      use: { label: t.card.use, onClick: noop },
    }),
    card("mini", {
      status: {
        state: "reconnecting",
        label: t.states.reconnecting,
        reason: t.failed(wait.attempt, MAX),
      },
      retry: lines[1]!,
    }),
    card("edge-1", {
      status: {
        state: "reconnectFailed",
        label: t.states.reconnectFailed,
        reason: t.refused("edge-1"),
      },
      retry: lines[2]!,
    }),
  ];

  // A model request's ladder, the attempt of the engine's ceiling, the first request included;
  // every line offers its details.
  const m = DEFAULT_MAX_TURN_ATTEMPTS;
  const next = wait.attempt + 1;
  const details = <TextAction onClick={() => setReportOpen(true)}>{t.openDetails}</TextAction>;
  const retry = <TextAction onClick={noop}>{t.retry}</TextAction>;
  const away = lines[1]!;

  return (
    <div className="gf-board">
      <BoardGroup title={t.phases} aside={t.phasesHint}>
        <div className="lib-stack">
          {lines.map((props, index) => (
            <RetryStatus key={index} {...props} />
          ))}
        </div>
      </BoardGroup>
      <BoardGroup title={t.blocks} aside={t.blocksHint}>
        <div className="lib-stack" style={{ maxWidth: "36rem" }}>
          {phases("sm").map((props, index) => (
            <RetryStatus key={index} {...props} />
          ))}
        </div>
      </BoardGroup>
      <BoardGroup title={t.inCard} aside={t.inCardHint}>
        <MachineList>
          {cards.map((props) => (
            <MachineCard key={props.id} {...props} />
          ))}
        </MachineList>
      </BoardGroup>
      <BoardGroup title={t.inChat} aside={t.inChatHint}>
        <div style={{ maxWidth: "46rem" }}>
          <div style={{ display: "flex", justifyContent: "center" }}>
            <MessageBubble variant="notice" actions={retry}>
              {t.chatEarlierFailed}
            </MessageBubble>
          </div>
          <Line
            phase="waiting"
            actions={
              <>
                <RetryActions
                  retry={{ label: t.retryNow, onClick: wait.retryNow }}
                  secondary={{ label: t.stop, onClick: noop }}
                  attemptKey={wait.nextAt}
                />
                {details}
              </>
            }
          >
            {left !== null && left > 0 ? (
              <CountdownText
                sentence={(s) => t.chatRetrying(t.chatWaiting(s, next, m), t.chatWhy)}
                seconds={left}
                wait={wait.nextAt}
              />
            ) : (
              <span>{t.chatRetrying(t.chatSending(next, m), t.chatWhy)}</span>
            )}
          </Line>
          <Line phase="trying" actions={details}>
            <span>{t.chatRetrying(t.chatSending(3, m), t.chatWhy)}</span>
          </Line>
          <Line phase="retried" actions={details}>
            <span>{t.chatRetried(t.chatSent(3, m), t.chatWhy)}</span>
          </Line>
          <Line
            phase="gaveUp"
            actions={
              <>
                {retry}
                {details}
              </>
            }
          >
            <span>{t.chatFailed(6, t.chatWhy)}</span>
          </Line>
          {/* A stop during a wait: the ladder's line, then the stop marker under it. */}
          <Line phase="gaveUp" actions={details}>
            <span>{t.chatFailedOnce(t.chatWhy)}</span>
          </Line>
          <MessageBubble variant="notice">{t.chatAborted}</MessageBubble>
          <MessageBubble
            variant="notice"
            actions={
              <>
                {retry}
                {details}
              </>
            }
          >
            {t.chatError(t.chatFatalWhy)}
          </MessageBubble>
        </div>
      </BoardGroup>
      <BoardGroup title={t.report} aside={t.reportHint}>
        <div>{details}</div>
        <ReportDialog
          open={reportOpen}
          onClose={() => setReportOpen(false)}
          title={t.reportTitle}
          description={
            <>
              <p>{t.reportLead}</p>
              <p>{t.reportCheck}</p>
            </>
          }
          report={REPORT}
          reportLabel={t.reportLabel}
          actions={
            <>
              <Button size="sm" onClick={noop}>
                {t.copy}
              </Button>
              <a
                href={ISSUE_FORM}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonClass("primary", "sm")}
              >
                {t.fileIssue}
              </a>
            </>
          }
        />
      </BoardGroup>
      <BoardGroup title={t.loadFailed} aside={t.loadFailedHint}>
        <div className="lib-stack" style={{ maxWidth: "46rem" }}>
          <div className="lib-box">
            <LoadFailed
              title={t.historyFailed}
              description={t.networkError}
              action={{ label: t.retry, onClick: noop }}
            />
          </div>
          <div className="lib-box">
            <LoadFailed
              glyph={ICONS.server}
              title={t.awayHeadline("mini")}
              description={t.awayHint}
              action={{ label: t.openMachines, onClick: noop }}
              details={{ title: t.details, text: t.transportError }}
            >
              <RetryStatus {...away} size="sm" className="justify-center text-left" />
            </LoadFailed>
          </div>
        </div>
      </BoardGroup>
      <BoardGroup title={t.narrow} aside={t.narrowHint}>
        <div style={{ maxWidth: "24rem" }}>
          <MachineList>
            <MachineCard {...cards[1]!} />
          </MachineList>
        </div>
      </BoardGroup>
    </div>
  );
}

function noop() {}
