/**
 * 重试: the one retry row every retrying surface shares — a machine's reconnect in its phases at a
 * card's size and at body size, inside a machine card beside a running one, a model request's
 * retry in a conversation (wearing the transcript's note frame, its cause in sight) and the line
 * a ladder that gave up ends the run with, beside the stop marker it matches; the text actions
 * every press takes, in both looks; the card at phone width; and the "could not load" notice a
 * pane shows in place of its content, with the row inside it while a machine is being brought
 * back. The wait counts down live, and a press holds its actions until the board starts the next
 * attempt.
 */
import { useEffect, useState } from "react";
import { DEFAULT_MAX_TURN_ATTEMPTS } from "@prismshadow/penguin-core/interfaces";
import {
  ICONS,
  LoadFailed,
  MachineCard,
  MachineList,
  MessageBubble,
  RetryStatus,
  TextAction,
} from "@prismshadow/penguin-ui";
import type { MachineCardProps, RetryStatusProps, TextActionLook } from "@prismshadow/penguin-ui";
import { BoardGroup } from "../../foundations/shared";
import { useGallery } from "../../state";

const ROOT = "/home/ubuntu/.penguin/data";
const VERSION = "v0.2.16";
/** The wait the demo's countdown runs; pressing Retry now starts it over, as a new attempt would. */
const WAIT_MS = 40_000;
const MAX = 5;

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

export function RetryBoard() {
  const { S } = useGallery();
  const t = S.library.retry;
  const wait = useDemoWait();
  const phases = (size: "xs" | "sm"): RetryStatusProps[] => [
    {
      phase: "trying",
      label: t.trying(4, MAX),
      reason: t.refused("mini"),
      reasonTitle: t.lastFailure,
      secondary: { label: t.stop, onClick: noop },
      size,
    },
    {
      phase: "waiting",
      label: t.trying(wait.attempt + 1, MAX),
      countdown: (s) => t.waiting(s, wait.attempt + 1, MAX),
      nextAt: wait.nextAt,
      reason: t.refused("mini"),
      reasonTitle: t.lastFailure,
      retry: { label: t.retryNow, onClick: wait.retryNow },
      secondary: { label: t.stop, onClick: noop },
      size,
    },
    {
      phase: "gaveUp",
      label: t.gaveUp(MAX),
      reason: t.refused("edge-1"),
      reasonTitle: t.lastFailure,
      retry: { label: t.retry, onClick: noop },
      size,
    },
    {
      phase: "cancelled",
      label: t.cancelled,
      reason: t.refused("mini"),
      reasonTitle: t.lastFailure,
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

  // A model request's ladder: the attempt of the engine's ceiling, the first request included.
  // Between the messages each wears the transcript's note frame, as its other notes do, its
  // cause and the provider's words after the sentence.
  const why = {
    reason: t.chatWhy(t.chatCause, t.chatError),
    reasonPlacement: "inline" as const,
    frame: "note" as const,
  };
  const chat: RetryStatusProps[] = [
    {
      phase: "waiting",
      label: t.chatSending(wait.attempt + 1, DEFAULT_MAX_TURN_ATTEMPTS),
      countdown: (s) => t.chatWaiting(s, wait.attempt + 1, DEFAULT_MAX_TURN_ATTEMPTS),
      nextAt: wait.nextAt,
      ...why,
      retry: { label: t.retryNow, onClick: wait.retryNow },
      secondary: { label: t.stop, onClick: noop },
    },
    { phase: "trying", label: t.chatSending(3, DEFAULT_MAX_TURN_ATTEMPTS), ...why },
    { phase: "retried", label: t.chatSent(3, DEFAULT_MAX_TURN_ATTEMPTS), ...why },
  ];
  // Older history that failed to load: the same row, stopped, centred above the transcript.
  const earlier: RetryStatusProps = {
    phase: "gaveUp",
    label: t.chatEarlierFailed,
    reason: t.networkError,
    reasonPlacement: "inline",
    retry: { label: t.retry, onClick: noop },
    className: "justify-center",
  };
  // The lines a run ends on, in either look of the text action: the ladder that gave up, the
  // stop marker it matches, and a failure whose provider message runs long (clamped, Expand).
  const endLines = (look: TextActionLook) => (
    <div className="lib-stack" style={{ maxWidth: "46rem" }}>
      {[
        t.chatFailed(6, t.chatCause, t.chatError),
        t.chatAborted,
        t.chatFailed(6, t.chatCause, t.chatLongError),
      ].map((line, index) => (
        <MessageBubble
          key={index}
          variant="notice"
          actions={
            <TextAction look={look} onClick={noop}>
              {t.retry}
            </TextAction>
          }
        >
          {line}
        </MessageBubble>
      ))}
    </div>
  );
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
        <div className="lib-stack" style={{ maxWidth: "46rem" }}>
          <RetryStatus {...earlier} />
          {chat.map((props, index) => (
            <RetryStatus key={index} {...props} />
          ))}
        </div>
      </BoardGroup>
      <BoardGroup title={t.ended} aside={t.endedHint}>
        <p className="lib-caption">{t.lookLink}</p>
        {endLines("link")}
        <p className="lib-caption">{t.lookBracket}</p>
        {endLines("bracket")}
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
