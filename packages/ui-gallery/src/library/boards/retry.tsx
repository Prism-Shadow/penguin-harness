/**
 * 重试: the one retry status every retrying surface shares — its four phases as a card's line and
 * as a dialog's block, inside a machine card beside a running one, the chat's reconnect notice
 * holding the same buttons, and the card at phone width. The wait counts down live, and a press
 * holds its buttons until the board starts the next attempt.
 */
import { useEffect, useState } from "react";
import {
  ICONS,
  MachineCard,
  MachineList,
  MessageBubble,
  RetryActions,
  RetryStatus,
} from "@prismshadow/penguin-ui";
import type { MachineCardProps, RetryStatusProps } from "@prismshadow/penguin-ui";
import { BoardGroup } from "../../foundations/shared";
import { useGallery } from "../../state";

const ROOT = "/home/ubuntu/.penguin/data";
const VERSION = "v0.2.16";
/** The wait the demo's countdown runs; pressing Retry now starts it over, as a new attempt would. */
const WAIT_MS = 40_000;
const MAX = 8;

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
  const phases = (layout: "line" | "block"): RetryStatusProps[] => [
    { phase: "trying", label: t.trying(4, MAX), layout },
    {
      phase: "waiting",
      label: t.failed(wait.attempt, MAX),
      nextAt: wait.nextAt,
      countdown: t.countdown,
      retry: { label: t.retryNow, onClick: wait.retryNow },
      layout,
      ...(layout === "block" ? { reason: t.lasting } : {}),
    },
    {
      phase: "gaveUp",
      label: t.gaveUp(MAX),
      reason: layout === "block" ? t.lasting : t.refused("edge-1"),
      retry: { label: t.retry, onClick: noop },
      layout,
    },
    {
      phase: "blocked",
      label: t.stoppedSsh,
      reason: t.hostKey,
      retry: { label: t.retry, onClick: noop },
      layout,
    },
    { phase: "blocked", label: t.stoppedPassword, reason: t.password, layout },
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
  const lines = phases("line");
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
        state: "reconnectStopped",
        label: t.states.reconnectStopped,
        reason: t.refused("edge-1"),
      },
      retry: lines[2]!,
    }),
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
          {phases("block").map((props, index) => (
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
          <MessageBubble
            variant="notice"
            tone="attention"
            actions={
              <RetryActions
                attemptKey={wait.nextAt}
                retry={{ label: t.chatRetryNow, onClick: wait.retryNow }}
                secondary={{ label: t.chatGiveUp, onClick: noop }}
              />
            }
          >
            <span>{t.chatLine(wait.attempt)}</span>
          </MessageBubble>
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
