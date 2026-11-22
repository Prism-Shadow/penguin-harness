/**
 * 按钮: the Button in its five variants and five sizes, the icon button, disabled and loading, the
 * link in a sentence and on its own, the flat glyph action inline after a name (a link and a
 * button), the inline icon button at the end of a stats line, the composer's dictation button in
 * its three states and the microphone meter beside it, the keyboard hint, and the floating ball on
 * a stage of its own, where it drags, docks to either edge and tucks away.
 */
import { useEffect, useState, type MouseEvent } from "react";
import {
  Button,
  FloatingBall,
  GlyphAction,
  GlyphIcon,
  ICONS,
  ICON_SIZE,
  IconButton,
  InlineIconButton,
  Kbd,
  Link,
  METER_BARS,
  MicrophoneMeter,
  PlusIcon,
  RecordButton,
  Spinner,
  type FloatingBallPlacement,
  type RecordButtonState,
} from "@prismshadow/penguin-ui";
import { BoardGroup } from "../../foundations/shared";
import { useGallery } from "../../state";

const RELEASES_URL = "https://github.com/Prism-Shadow/penguin-harness/releases";

/** The in-sentence link points nowhere real; following it would navigate the board's frame away. */
const stay = (event: MouseEvent) => event.preventDefault();

export function ButtonsBoard() {
  const { S } = useGallery();
  const t = S.library.buttons;
  return (
    <div className="gf-board">
      <BoardGroup title={t.variants}>
        <div className="lib-row">
          <Button variant="primary">{t.primary}</Button>
          <Button variant="secondary">{t.secondary}</Button>
          <Button variant="danger">{t.danger}</Button>
          <Button variant="ghost">{t.ghost}</Button>
          <Button variant="link">{t.link}</Button>
        </div>
      </BoardGroup>
      <BoardGroup title={t.sizes}>
        <div className="lib-row">
          <Button variant="primary" size="md">
            {t.md}
          </Button>
          <Button variant="primary" size="sm">
            {t.sm}
          </Button>
          <Button variant="secondary" size="xs">
            {t.xs}
          </Button>
          <Button variant="secondary" size="sm" leading={<PlusIcon />}>
            {t.leading}
          </Button>
        </div>
      </BoardGroup>
      <BoardGroup title={t.icon} aside={t.iconHint}>
        <div className="lib-row">
          <IconButton label={t.add}>
            <PlusIcon />
          </IconButton>
          <IconButton label={t.add} size="sm">
            <PlusIcon />
          </IconButton>
          <IconButton label={t.edit} variant="ghost">
            <GlyphIcon d={ICONS.pencil} />
          </IconButton>
          <IconButton label={t.danger} variant="danger">
            <GlyphIcon d={ICONS.trash} />
          </IconButton>
        </div>
      </BoardGroup>
      <BoardGroup title={t.states}>
        <div className="lib-row">
          <Button variant="primary" disabled>
            {t.disabled}
          </Button>
          <Button variant="secondary" disabled>
            {t.disabled}
          </Button>
          <Button variant="primary" loading loadingLabel={t.busy}>
            {t.busy}
          </Button>
          <Button variant="secondary" size="sm" loading loadingLabel={t.busy}>
            {t.busy}
          </Button>
          <IconButton label={t.add} loading loadingLabel={t.busy}>
            <PlusIcon />
          </IconButton>
        </div>
      </BoardGroup>
      <BoardGroup title={t.links} aside={t.linksHint}>
        <div className="lib-stack">
          <p className="text-sm">
            {t.inlineBefore}
            <Link href="#release-notes" onClick={stay}>
              {t.inlineLink}
            </Link>
            {t.inlineAfter}
          </p>
          <div className="lib-row">
            <Link href={RELEASES_URL} external variant="standalone" className="text-sm">
              {t.external}
            </Link>
            <Link href={RELEASES_URL} external variant="standalone" className="text-xs">
              {t.external}
            </Link>
          </div>
        </div>
      </BoardGroup>
      <BoardGroup title={t.glyphActions} aside={t.glyphActionsHint}>
        <div className="lib-stack">
          <div className="flex items-center gap-1.5 text-xs text-fg-muted">
            <span>{t.glyphAuthor}</span>
            <GlyphAction glyph={ICONS.globe} label={t.glyphHomepage} href={RELEASES_URL} />
            <GlyphAction glyph={ICONS.gitBranch} label={t.glyphRepository} href={RELEASES_URL} />
          </div>
          <div className="flex items-center gap-1.5 text-sm">
            <span className="font-mono">{t.glyphSkill}</span>
            <GlyphAction glyph={ICONS.puzzle} label={t.glyphFromPlugin} onClick={() => {}} />
          </div>
        </div>
      </BoardGroup>
      <BoardGroup title={t.inlineIcon} aside={t.inlineIconHint}>
        <div className="lib-stack">
          <div className="flex items-center gap-1.5 text-xs text-fg-muted">
            <span className="tabular-nums">{t.inlineReplyStats}</span>
            <InlineIconButton label={t.inlineRead}>
              <GlyphIcon d={ICONS.speaker} />
            </InlineIconButton>
            <InlineIconButton label={t.inlineFork}>
              <GlyphIcon d={ICONS.gitBranch} />
            </InlineIconButton>
            <InlineIconButton label={t.inlineBusy} disabled>
              <Spinner size="sm" label={t.inlineBusy} />
            </InlineIconButton>
          </div>
          <div className="flex items-center gap-1.5 text-sm">
            <InlineIconButton label={t.inlineRead} size="md">
              <GlyphIcon d={ICONS.speaker} />
            </InlineIconButton>
            <span className="lib-caption">md</span>
          </div>
        </div>
      </BoardGroup>
      <BoardGroup title={t.record} aside={t.recordHint}>
        <RecordButtonStage />
      </BoardGroup>
      <BoardGroup title={t.meter} aside={t.meterHint}>
        <MeterStage />
      </BoardGroup>
      <BoardGroup title={t.keys}>
        <div className="lib-row">
          {t.shortcuts.map((keys) => (
            <Kbd key={keys.join("+")} keys={keys} />
          ))}
        </div>
      </BoardGroup>
      <BoardGroup title={t.ball} aside={t.ballHint}>
        <FloatingBallStage />
      </BoardGroup>
    </div>
  );
}

/**
 * The ball over a box standing in for a page: the box clips like a window edge, and the board
 * holds the placement the way a page stores it, reading it out under the box.
 */
function FloatingBallStage() {
  const { S } = useGallery();
  const t = S.library.buttons;
  const [placement, setPlacement] = useState<FloatingBallPlacement>({
    side: "right",
    ratio: 1,
    tucked: false,
  });
  const [presses, setPresses] = useState(0);
  return (
    <div className="lib-stack lib-stack-wide">
      <div className="lib-box relative isolate h-56">
        <FloatingBall
          placement={placement}
          onChange={setPlacement}
          onActivate={() => setPresses((n) => n + 1)}
          glyph={<GlyphIcon d={ICONS.cornersIn} size={ICON_SIZE.launcherEntry} />}
          label={t.ballLabel}
          tuckLabel={t.ballTuck}
          showLabel={t.ballShow}
        />
      </div>
      <span className="lib-caption">
        {t.ballReadout(
          placement.side,
          Math.round(placement.ratio * 100),
          placement.tucked,
          presses,
        )}
      </span>
    </div>
  );
}

/** The dictation button's three states, and one that walks through them as a dictation would. */
function RecordButtonStage() {
  const { S } = useGallery();
  const t = S.library.buttons;
  const label: Record<RecordButtonState, string> = {
    idle: t.recordIdle,
    recording: t.recordRecording,
    waiting: t.recordWaiting,
  };
  const [state, setState] = useState<RecordButtonState>("idle");
  useEffect(() => {
    if (state !== "waiting") return;
    const done = window.setTimeout(() => setState("idle"), 1200);
    return () => window.clearTimeout(done);
  }, [state]);
  return (
    <div className="lib-row">
      {(["idle", "recording", "waiting"] as const).map((s) => (
        <span key={s} className="lib-cell">
          <RecordButton state={s} label={label[s]} onClick={() => {}} />
          <span className="lib-caption">{s}</span>
        </span>
      ))}
      <span className="lib-cell">
        <RecordButton state="idle" label={label.idle} disabled onClick={() => {}} />
        <span className="lib-caption">{t.disabled}</span>
      </span>
      <span className="lib-cell">
        <RecordButton
          state={state}
          label={label[state]}
          onClick={() => setState(state === "idle" ? "recording" : "waiting")}
        />
        <span className="lib-caption">{label[state]}</span>
      </span>
    </div>
  );
}

/** A level that rises and falls like speech, so the bars move without a microphone. */
function speechLevel(tick: number): number {
  const syllable = Math.max(0, Math.sin(tick / 2.3)) * Math.max(0, Math.sin(tick / 9));
  return Math.round(Math.min(1, syllable * 1.2) * 100);
}

/**
 * The meter fed a made-up voice, next to its reduced-motion words and its no-level fallback. The
 * row is their container, as a composer's card is, since the meter sizes by its container.
 */
function MeterStage() {
  const { S } = useGallery();
  const t = S.library.buttons;
  const labels = {
    level: t.meterLevel,
    quiet: t.meterQuiet,
    sound: t.meterSound,
    recording: t.meterRecording,
  };
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setTick((n) => n + 1), 75);
    return () => window.clearInterval(timer);
  }, []);
  const levels = Array.from({ length: METER_BARS }, (_, i) =>
    speechLevel(tick - METER_BARS + 1 + i),
  );
  const seconds = Math.floor((tick * 75) / 1000);
  return (
    <div className="@container lib-row">
      <span className="lib-cell">
        <MicrophoneMeter
          levels={levels}
          seconds={seconds}
          available
          reduceMotion={false}
          labels={labels}
        />
        <span className="lib-caption">{t.meterLive}</span>
      </span>
      <span className="lib-cell">
        <MicrophoneMeter levels={levels} seconds={seconds} available reduceMotion labels={labels} />
        <span className="lib-caption">{t.meterReduced}</span>
      </span>
      <span className="lib-cell">
        <MicrophoneMeter
          levels={levels}
          seconds={seconds}
          available={false}
          reduceMotion={false}
          labels={labels}
        />
        <span className="lib-caption">{t.meterUnavailable}</span>
      </span>
    </div>
  );
}
