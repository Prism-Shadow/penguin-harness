/**
 * 重试: the one retry row every retrying surface shares — a machine's reconnect in its phases at a
 * card's size and at body size, inside a machine card beside a running one, a model request's
 * retry in a conversation, and the card at phone width. The wait counts down live, and a press
 * holds its actions until the board starts the next attempt.
 */
import { useEffect, useState } from "react";
import { DEFAULT_MAX_TURN_ATTEMPTS } from "@prismshadow/penguin-core/interfaces";
import { ICONS, MachineCard, MachineList, RetryStatus } from "@prismshadow/penguin-ui";
import type { MachineCardProps, RetryStatusProps } from "@prismshadow/penguin-ui";
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
  const why = { reason: t.chatError, reasonTitle: t.chatCause };
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
    {
      phase: "gaveUp",
      label: t.chatGaveUp(6),
      ...why,
      retry: { label: t.retry, onClick: noop },
    },
  ];

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
          {chat.map((props, index) => (
            <RetryStatus key={index} {...props} />
          ))}
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
