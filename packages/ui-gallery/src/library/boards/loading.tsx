/**
 * 加载: the running-state spinner on its three rungs; the waiting state — its rows, its page and a
 * caller's own cards, shown as they look once a wait is slow, then the same three in every theme
 * side by side, each theme in a frame of its own (a theme's recipes key on the document root),
 * and a replay that answers one region inside the delay and the other after it, so the first
 * never shows a placeholder and the second shows it only from the delay on; the progress bar on
 * its three heights, toned and indeterminate; the staged bar in each state of its current stage;
 * and the transfer row in every place a
 * conversation's history coming over from a machine shows it — standing in for the transcript
 * (counting, not yet counted, waiting for the machine), over the transcript (going on, and
 * waiting in the same line), under an unfolded output.
 *
 * Opened on its `waiting` part (frame.ts), the board is the three waiting samples alone: what
 * each theme's frame shows.
 */
import { useEffect, useRef, useState } from "react";
import {
  GlyphIcon,
  ICONS,
  ICON_SIZE,
  ProgressBar,
  RetryStatus,
  SkeletonCard,
  StagedProgress,
  StatusIcon,
  THEME_IDS,
  TransferProgress,
  WAITING_DELAY_MS,
  Waiting,
} from "@prismshadow/penguin-ui";
import type {
  ProgressBarSize,
  ProgressStage,
  StagedProgressStatus,
  StatusIconSize,
  ThemeId,
} from "@prismshadow/penguin-ui";
import { BoardGroup, ReplayButton } from "../../foundations/shared";
import { BASE } from "../../lib/location";
import { useGallery } from "../../state";
import { useText } from "../../text";
import { LIBRARY_HEIGHT_MESSAGE, libraryFrameSrc } from "../frame";
import type { LibraryPart } from "../frame";

/** The rungs and the pixels each one draws at. */
const SPINNER_RUNGS: readonly (readonly [StatusIconSize, number])[] = [
  ["xs", 10],
  ["sm", 12],
  ["md", 14],
];

/** The bar's heights, each at its own reading. */
const BAR_RUNGS: readonly (readonly [ProgressBarSize, number])[] = [
  ["xs", 30],
  ["sm", 60],
  ["md", 90],
];

/** A staged job's stages, as an install has them: the download gets the room for its amount. */
const STAGES: readonly ProgressStage[] = [
  { key: "check" },
  { key: "fetch", weight: 3 },
  { key: "start" },
  { key: "choose" },
];

/** The staged bar's states, each at the place that shows it. */
const STAGED: readonly {
  key: "stagedLive" | "stagedAmount" | "stagedWaiting" | "stagedStopped" | "stagedFinished";
  current: number;
  value?: number;
  status: StagedProgressStatus;
}[] = [
  { key: "stagedLive", current: 0, status: "running" },
  { key: "stagedAmount", current: 1, value: 0.45, status: "running" },
  { key: "stagedWaiting", current: 3, status: "waiting" },
  { key: "stagedStopped", current: 1, value: 0.6, status: "stopped" },
  { key: "stagedFinished", current: 4, status: "running" },
];

/** The demo's amounts, as the Web App formats them: one unit per total, the done figure padded. */
const AMOUNTS = {
  window: { amount: "\u2007120 / 380 KB", value: 120, max: 380 },
  fill: { amount: "3.2 / 9.6 MB", value: 3.2, max: 9.6 },
  older: { amount: "\u2007\u200740 / 210 KB", value: 40, max: 210 },
  body: { amount: "\u200712 / 480 KB", value: 12, max: 480 },
} as const;

export function LoadingBoard({ part }: { part?: LibraryPart }) {
  const { S } = useGallery();
  const t = S.library.loading;
  // The link-down row counts down to a moment a little ahead, as the server's retry would.
  const [nextAt] = useState(() => Date.now() + 6_000);
  if (part === "waiting") {
    return (
      <div className="gf-board">
        <WaitingSamples />
      </div>
    );
  }
  return (
    <div className="gf-board">
      <BoardGroup title={t.spinner} aside={t.sizes}>
        <div className="lib-row">
          {SPINNER_RUNGS.map(([size, px]) => (
            <span key={size} className="lib-cell">
              <StatusIcon state="running" size={size} />
              <span className="lib-caption">
                {size} · {px}px
              </span>
            </span>
          ))}
        </div>
      </BoardGroup>
      <BoardGroup title={t.waiting} aside={t.waitingHint(WAITING_DELAY_MS)}>
        <WaitingSamples />
      </BoardGroup>
      <WaitingThemes />
      <WaitingReplay />
      <BoardGroup title={t.progress} aside={t.progressHint}>
        <div className="lib-stack">
          {BAR_RUNGS.map(([size, value]) => (
            <div key={size} className="grid gap-1">
              <span className="lib-caption">
                {size} · {value}%
              </span>
              <ProgressBar size={size} value={value} label={t.progressLabel} />
            </div>
          ))}
          <div className="grid gap-1">
            <span className="lib-caption">{t.progressOver}</span>
            <ProgressBar value={100} tone="danger" label={t.progressLabel} />
          </div>
          <div className="grid gap-1">
            <span className="lib-caption">{t.progressIndeterminate}</span>
            <ProgressBar indeterminate size="md" label={t.progressLabel} />
          </div>
        </div>
      </BoardGroup>
      <BoardGroup title={t.staged} aside={t.stagedHint}>
        <div className="lib-stack" style={{ maxWidth: "28rem" }}>
          {STAGED.map(({ key, ...bar }) => (
            <div key={key} className="grid gap-1">
              <span className="lib-caption">{t[key]}</span>
              <StagedProgress stages={STAGES} {...bar} label={t.stagedLabel} />
            </div>
          ))}
          <div className="grid gap-1">
            <span className="lib-caption">xs</span>
            <StagedProgress
              stages={STAGES}
              current={1}
              value={0.45}
              size="xs"
              label={t.stagedLabel}
            />
          </div>
        </div>
      </BoardGroup>
      <BoardGroup title={t.transfer} aside={t.transferHint}>
        <div className="lib-stack" style={{ maxWidth: "36rem" }}>
          <div className="grid gap-1">
            <span className="lib-caption">{t.transferPane}</span>
            <TransferProgress size="sm" label={t.transferWindow("gpu-box")} {...AMOUNTS.window} />
          </div>
          <div className="grid gap-1">
            <span className="lib-caption">{t.transferUncounted}</span>
            <TransferProgress size="sm" label={t.transferWindow("gpu-box")} />
          </div>
          <div className="grid gap-1">
            <span className="lib-caption">{t.transferPaneWaiting}</span>
            <TransferProgress size="sm" label={t.transferWindow("gpu-box")} {...AMOUNTS.window} />
            <RetryStatus
              phase="waiting"
              label={t.transferTrying(2)}
              countdown={(s) => t.transferRetryIn(s, 2)}
              nextAt={nextAt}
              retry={{ label: t.transferRetryNow, onClick: noop }}
              size="sm"
            />
          </div>
          <div className="grid gap-1">
            <span className="lib-caption">{t.transferTop}</span>
            <TransferProgress mark={null} label={t.transferFill} {...AMOUNTS.fill} />
            <TransferProgress mark={null} label={t.transferOlder} {...AMOUNTS.older} />
          </div>
          <div className="grid gap-1">
            <span className="lib-caption">{t.transferTopWaiting}</span>
            <TransferProgress
              mark={
                <GlyphIcon
                  d={ICONS.hourglass}
                  size={ICON_SIZE.inlineGlyph}
                  className="text-tone-attention-fg"
                />
              }
              label={t.transferTrying(2)}
              {...AMOUNTS.fill}
            />
          </div>
          <div className="grid gap-1" data-sample="slow">
            <span className="lib-caption">{t.transferSlowCaption}</span>
            <TransferProgress
              mark={
                <GlyphIcon
                  d={ICONS.hourglass}
                  size={ICON_SIZE.inlineGlyph}
                  className="text-tone-attention-fg"
                />
              }
              label={t.transferSlow("gpu-box")}
              {...AMOUNTS.fill}
            />
            <TransferProgress size="sm" label={t.transferWindow("gpu-box")} {...AMOUNTS.window} />
            <RetryStatus phase="waiting" label={t.transferSlow("gpu-box")} size="sm" />
          </div>
          <div className="grid gap-1">
            <span className="lib-caption">{t.transferBody}</span>
            <TransferProgress label={t.transferBodyLabel} {...AMOUNTS.body} />
          </div>
        </div>
      </BoardGroup>
    </div>
  );
}

/** The waiting state's three forms as they look once a wait is slow: rows, a page, cards. */
function WaitingSamples() {
  const { S } = useGallery();
  const t = S.library.loading;
  return (
    <div className="lib-stack">
      <div className="grid gap-1">
        <span className="lib-caption">{t.waitingRows}</span>
        <div className="lib-box">
          <Waiting rows={3} delay={0} />
        </div>
      </div>
      <div className="grid gap-1">
        <span className="lib-caption">{t.waitingPage}</span>
        <Waiting form="page" delay={0} />
      </div>
      <div className="grid gap-1">
        <span className="lib-caption">{t.waitingCards}</span>
        <Waiting delay={0} className="grid gap-3 sm:grid-cols-2">
          <SkeletonCard />
          <SkeletonCard />
        </Waiting>
      </div>
    </div>
  );
}

/** The height a theme's frame shows at until its samples have reported one. */
const THEME_FRAME_PENDING_HEIGHT = 480;

/**
 * The waiting samples in one theme: this board opened on its `waiting` part in a frame under that
 * theme and the board's own mode, size and fonts, as tall as the samples report.
 */
function ThemeFrame({ theme }: { theme: ThemeId }) {
  const { S, state } = useGallery();
  const text = useText();
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState<number | null>(null);
  const src = libraryFrameSrc(
    BASE,
    {
      theme,
      mode: state.mode,
      accent: state.accent,
      size: state.size,
      latin: state.latin,
      cjk: state.cjk,
      lang: state.lang,
    },
    "loading",
    "waiting",
  );
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      const data: unknown = event.data;
      if (typeof data !== "object" || data === null) return;
      const { type, height: reported } = data as { type?: unknown; height?: unknown };
      if (type !== LIBRARY_HEIGHT_MESSAGE || typeof reported !== "number") return;
      setHeight(Math.ceil(reported));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);
  const name = text.theme(theme);
  return (
    <div className="grid min-w-0 gap-1 self-start">
      <span className="lib-caption">{name}</span>
      <div className="lib-box">
        <iframe
          ref={frame}
          className="lib-theme-frame"
          title={S.library.loading.waitingThemeFrame(name)}
          src={src}
          style={{ height: height ?? THEME_FRAME_PENDING_HEIGHT }}
        />
      </div>
    </div>
  );
}

/** Every built-in theme's waiting state side by side. */
function WaitingThemes() {
  const { S } = useGallery();
  const t = S.library.loading;
  return (
    <BoardGroup title={t.waitingThemes} aside={t.waitingThemesHint}>
      <div className="grid gap-4 md:grid-cols-2">
        {THEME_IDS.map((id) => (
          <ThemeFrame key={id} theme={id} />
        ))}
      </div>
    </BoardGroup>
  );
}

/** How long the slow region of the replay takes to answer, in ms. */
const SLOW_ANSWER_MS = 1600;

/**
 * One region of the replay: it waits on a read that answers after `answerMs`, then shows its
 * content. Remounted by the replay, so each run starts its wait from nothing.
 */
function ReplayRegion({ answerMs, content }: { answerMs: number; content: string }) {
  const [answered, setAnswered] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setAnswered(true), answerMs);
    return () => clearTimeout(timer);
  }, [answerMs]);
  return (
    <div className="lib-box" style={{ minHeight: "7.5rem" }}>
      {answered ? <p className="p-3 text-sm text-fg">{content}</p> : <Waiting rows={3} />}
    </div>
  );
}

/** A quick answer beside a slow one, replayed: the quick one never shows its wait. */
function WaitingReplay() {
  const { S } = useGallery();
  const t = S.library.loading;
  const [run, setRun] = useState(0);
  return (
    <BoardGroup
      title={t.waitingReplay}
      aside={t.waitingReplayHint}
      action={<ReplayButton onClick={() => setRun((n) => n + 1)} />}
    >
      <div className="lib-stack" style={{ maxWidth: "36rem" }}>
        <div className="grid gap-1">
          <span className="lib-caption">{t.waitingQuick(WAITING_DELAY_MS / 2)}</span>
          <ReplayRegion
            key={`quick-${run}`}
            answerMs={WAITING_DELAY_MS / 2}
            content={t.waitingContent}
          />
        </div>
        <div className="grid gap-1">
          <span className="lib-caption">{t.waitingSlow(SLOW_ANSWER_MS)}</span>
          <ReplayRegion key={`slow-${run}`} answerMs={SLOW_ANSWER_MS} content={t.waitingContent} />
        </div>
      </div>
    </BoardGroup>
  );
}

function noop() {}
