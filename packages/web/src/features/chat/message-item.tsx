/**
 * Rendering dispatch for a single view-model item: user prompts are
 * right-aligned brand bubbles (including image thumbnails), thinking collapsible blocks, text
 * streamed as Markdown, tool cards, subagent cards, compaction banners, abort markers, and Task
 * stats lines. Items have a light entrance animation.
 */
import { useEffect, useState } from "react";
import { S } from "../../lib/strings";
import { useLocale } from "../../state/locale";
import { formatMessageTime } from "../../lib/format";
import { STAT_ICONS } from "../../lib/stat-icons";
import { splitAttachments } from "../../lib/attachments";
import type { ChatItem, ReconnectItem } from "../../lib/omni/stream-model";
import { parseAbortReason } from "@prismshadow/penguin-core/omnimessage";
import { Md } from "./md";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { CopyButton } from "../../components/ui/copy-button";
import { ZoomableImage } from "../../components/ui/image-zoom";
import { MessageFilesCard } from "./message-files-card";
import { MemoryChangesCard } from "./memory-changes-card";
import { ThinkingBlock } from "./thinking-block";
import { ToolCallCard } from "./tool-call-card";
import { SubagentChip } from "./subagent-chip";
import { CompactionBanner } from "./compaction-banner";
import { McpConnectBanner } from "./mcp-connect-banner";
import { GoalRoundBanner } from "./goal-banner";
import { HandoffBanner, ModelSwitchBanner } from "./handoff-banner";
import { ScheduledBanner } from "./scheduled-banner";
import { SkillsBanner } from "./skills-banner";
import { AttachedFilesBanner } from "./attached-files-banner";
import { BackgroundDoneBanner } from "./background-done-banner";
import {
  parseBackgroundTaskDoneMessage,
  parseHandoffMessage,
  parseModelSwitchMessage,
  parseScheduledMessage,
} from "./agent-handoff";
import { parseGoalMessage } from "./goal-use";
import { parseSkillsMessage } from "./skill-use";
import { TaskStatsLine } from "./task-stats-line";
import type { StreamRenderContext } from "./message-stream";
import { toneInk } from "../../lib/tone";

/** User glyph (24×24 line path) for the mid-run steering chip. */
const USER_STEERING_ICON =
  "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0";

/**
 * Message footer: timestamp + copy. At ≥sm it is **invisible but takes up space by default**
 * (`sm:opacity-0` rather than `hidden`) — it surfaces on hovering the message list, and because
 * the space is always reserved, surfacing it never pushes content below it down (using `hidden`
 * would cause every item to jitter). Keyboard users can also reveal it via `focus-within`
 * (otherwise the copy button would be focusable but never visible). Below sm the footer is
 * always visible — hover doesn't exist on touch screens (and Tailwind v4 scopes hover: variants
 * to `@media (hover: hover)`), so a hover-revealed footer would simply never appear on phones;
 * same treatment as the AI reply's stats footer.
 *
 * When `text` is omitted, only the timestamp is shown, no copy button — there's no clear meaning
 * to copying an image message.
 */
function MessageMeta({
  atMs,
  text,
  align = "left",
}: {
  atMs?: number;
  text?: string;
  align?: "left" | "right";
}) {
  const { locale } = useLocale();
  return (
    <div
      className={`flex h-5 items-center gap-2 transition-opacity duration-150 group-hover:opacity-100 focus-within:opacity-100 sm:opacity-0 ${
        align === "right" ? "justify-end" : "justify-start"
      }`}
    >
      {atMs !== undefined && (
        <span className="text-[11px] text-gray-400">{formatMessageTime(atMs, locale)}</span>
      )}
      {/* No copy button for image-only messages: copying an image message has no clear meaning. */}
      {text !== undefined && <CopyButton text={text} label={S.chat.copyMessage} />}
    </div>
  );
}

/** Countdown floor: waits shorter than this keep the plain waiting text (sub-second flashes of numbers are noise). */
const COUNTDOWN_MIN_MS = 2000;

/**
 * Reconnect hint line. The live waiting state renders a COUNTDOWN to the next attempt when
 * the engine announced its planned wait (request_end.retry_in_ms ≥ 2s — with the
 * exponential ladder a wait can reach 30s, and a static "waiting" line reads as a hang),
 * plus two inline controls: "retry now" (skips the remaining backoff server-side; the line
 * flips to "retrying" when the request_begin arrives — no optimistic state beyond
 * disabling the buttons) and "give up" (the ordinary session abort; the engine's
 * abort-during-backoff path ends the turn and re-enables the composer). Anchored on the
 * CLIENT arrival time of the event (skew-free), ticking every 250ms with ceil'd whole
 * seconds; at zero it falls back to the plain waiting text, so a stale item can never tick
 * forever. History safety: replay delivers the following request_begin/abort immediately,
 * flipping the state, so neither the countdown nor the buttons render for replayed items;
 * the buttons are additionally main-session-only (a subagent's backoff belongs to the
 * child session, which the retry-now route does not target).
 */
function ReconnectLine({ item, ctx }: { item: ReconnectItem; ctx: StreamRenderContext }) {
  const state = item.gaveUp ? "gaveUp" : item.retrying ? "retried" : "waiting";
  const target =
    state === "waiting" &&
    item.plannedDelayMs !== undefined &&
    item.plannedDelayMs >= COUNTDOWN_MIN_MS &&
    item.arrivedAtMs !== undefined
      ? item.arrivedAtMs + item.plannedDelayMs
      : null;
  const [now, setNow] = useState(() => Date.now());
  const [acted, setActed] = useState(false);
  useEffect(() => {
    if (target === null || Date.now() >= target) return;
    const timer = setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= target) clearInterval(timer); // stop ticking once the wait has elapsed
    }, 250);
    return () => clearInterval(timer);
  }, [target]);
  const remainingMs = target !== null ? target - now : 0;
  const live = target !== null && remainingMs > 0;
  const seconds = live ? Math.ceil(remainingMs / 1000) : undefined;
  const showControls =
    live && ctx.origin.length === 0 && (ctx.onRetryNow !== undefined || ctx.onGiveUp !== undefined);
  return (
    <p
      className={`anim-msg my-1 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-xs ${toneInk.attention}`}
    >
      <span>{S.chat.reconnect(item.status, state, item.attempt, seconds)}</span>
      {showControls && (
        <span className="flex shrink-0 items-center gap-1.5">
          {ctx.onRetryNow && (
            <button
              type="button"
              disabled={acted}
              onClick={() => {
                setActed(true);
                ctx.onRetryNow!();
              }}
              className="rounded border border-amber-300 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 transition-colors duration-150 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-amber-700 dark:text-amber-400 dark:hover:bg-amber-950/40"
            >
              {S.chat.reconnectRetryNow}
            </button>
          )}
          {ctx.onGiveUp && (
            <button
              type="button"
              disabled={acted}
              onClick={() => {
                setActed(true);
                ctx.onGiveUp!();
              }}
              className="rounded border border-gray-300 px-1.5 py-0.5 text-[11px] text-gray-500 transition-colors duration-150 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-800"
            >
              {S.chat.reconnectGiveUp}
            </button>
          )}
        </span>
      )}
    </p>
  );
}

export function MessageItem({ item, ctx }: { item: ChatItem; ctx: StreamRenderContext }) {
  switch (item.kind) {
    case "user_text": {
      // Source block for a chat created via the /agent handoff: collapsed into a single-line handoff notice (the raw text isn't shown), clickable to jump back to the original chat.
      const handoff = parseHandoffMessage(item.text);
      if (handoff) return <HandoffBanner origin={handoff} />;
      // Source block for a chat opened by the /model switch: collapsed into a single-line switch notice, clickable to jump back to the source conversation.
      const modelSwitch = parseModelSwitchMessage(item.text);
      if (modelSwitch) return <ModelSwitchBanner origin={modelSwitch} />;
      // Harness-injected completion notice of a run_in_background task: collapsed into a
      // one-line banner with the report body below it (the raw block shows on the Trace page).
      const backgroundDone = parseBackgroundTaskDoneMessage(item.text);
      if (backgroundDone) {
        return <BackgroundDoneBanner done={backgroundDone.done} body={backgroundDone.rest} />;
      }
      // A goal round's [goal] protocol prefix: collapsed into a round notice; the body after
      // it (round 1: the user's original input, skill blocks and all; later rounds: the
      // objective) continues down the normal parsing chain (the Trace shows the raw block).
      const goalRound = parseGoalMessage(item.text);
      const afterGoal = goalRound ? goalRound.rest : item.text;
      // Source block for a scheduled-task trigger: collapsed into a single-line notice, with the task's prompt body rendered as usual (verbatim on the Trace page).
      const scheduled = parseScheduledMessage(afterGoal);
      // Source block for a skill invocation: parsing continues on scheduled's remaining body
      // (goal -> scheduled -> skills, blocks stripped in a chain); a match collapses into a
      // "using skill" banner, with the body rendered as usual.
      const afterScheduled = scheduled ? scheduled.rest : afterGoal;
      const skills = parseSkillsMessage(afterScheduled);
      // Attachment row restoration (last in the chain — these lines trail the body rather than
      // prefixing it): for models that don't support images, input images are written to disk
      // as a path row; this pulls that out at render time and shows the actual image. Mirrors
      // the vision-model path (user_text + user_image as separate messages) in shape: one
      // bubble for the text, one bubble per image, styled the same as user_image. Uploaded
      // files come out of the same pass and collapse into one banner naming them.
      const { text, images, files } = splitAttachments(skills ? skills.rest : afterScheduled);
      // Every goal round reads like a normal user message: the body in a user bubble with
      // the round notice beneath (the system IS re-sending the user's request each round) —
      // the objective's images included, since they ride it as path lines.
      if (goalRound) {
        return (
          <>
            {skills && <SkillsBanner names={skills.skills} />}
            <GoalRoundBanner round={goalRound.round} objective={text} images={images} />
          </>
        );
      }
      return (
        <>
          {scheduled && <ScheduledBanner origin={scheduled.origin} />}
          {skills && <SkillsBanner names={skills.skills} />}
          {text && (
            <div className="anim-msg group my-4 flex flex-col items-end">
              <div className="max-w-[88%] rounded-lg bg-gray-100 px-4 py-2.5 md:max-w-[75%] dark:bg-gray-800">
                {/* wrap-anywhere: long unbroken strings like attachment paths/long URLs wrap within the bubble on narrow (mobile) screens instead of overflowing; unlike break-words it also shrinks min-content, so a pathological token can't stretch the flex bubble itself. Normal words still only break when a token can't fit on a line. */}
                <p className="wrap-anywhere whitespace-pre-wrap text-base leading-relaxed text-gray-900 dark:text-gray-100">
                  {text}
                </p>
              </div>
              <MessageMeta
                {...(item.atMs !== undefined ? { atMs: item.atMs } : {})}
                text={text}
                align="right"
              />
            </div>
          )}
          {/* Files uploaded with this message: shown below the text in the same user-side
              container and with the same timestamp footer as uploaded images. The bytes live in
              the session scratchpad, where the model opens them by path (goal mode never gets
              here: it takes text and images only). */}
          {files.length > 0 && (
            <div className="anim-msg group my-4 flex flex-col items-end">
              <AttachedFilesBanner files={files} />
              <MessageMeta
                {...(item.atMs !== undefined ? { atMs: item.atMs } : {})}
                align="right"
              />
            </div>
          )}
          {images.map((src, i) => (
            <div key={i} className="anim-msg group my-4 flex flex-col items-end">
              <div className="max-w-[88%] rounded-lg bg-gray-100 p-1.5 md:max-w-[75%] dark:bg-gray-800">
                <ZoomableImage
                  src={src}
                  alt={S.chat.imageAlt}
                  className="max-h-48 max-w-full rounded-md"
                />
              </div>
              <MessageMeta
                {...(item.atMs !== undefined ? { atMs: item.atMs } : {})}
                align="right"
              />
            </div>
          ))}
        </>
      );
    }
    case "background_notice": {
      // A background completion notice steered into the running Task (delivery: steering on
      // its block): the same collapsed banner as a task-starting notice, but the dedicated
      // item kind keeps it inside the running Task — no new turn, no outline entry, and the
      // stats row still arrives once, at task end.
      const done = parseBackgroundTaskDoneMessage(item.text);
      if (done) return <BackgroundDoneBanner done={done.done} body={done.rest} />;
      return null; // unreachable: the reducer only creates this kind from a parsed notice
    }
    case "user_steering": {
      // Mid-run steering ([user_steering]-wrapped user text delivered between turns): a
      // compact right-aligned user-styled chip inside the running Task's flow — visually
      // lighter than a full prompt bubble, since it doesn't start a new Task (the Trace page
      // still shows the raw marker text as-is).
      // Images sent with the message live inside the same chip: `item.images` on a vision
      // model (delivered as image messages right behind the text), or restored from the
      // [attached image: …] path lines without one — the same two shapes a user_text bubble
      // handles, so both render identically here. Files ride steering only as
      // [attached file: …] rows (there is no item.files channel) and collapse into the same
      // banner a full prompt uses, kept inside the chip — a files-only steering would
      // otherwise render as an empty chip with the filenames lost.
      const {
        text: steerText,
        images: steerImages,
        files: steerFiles,
      } = splitAttachments(item.text);
      const shown = [...steerImages, ...(item.images ?? [])];
      return (
        <div className="anim-msg group my-2 flex flex-col items-end">
          <div className="flex max-w-[88%] flex-col gap-1.5 rounded-md border border-gray-200 bg-gray-100 px-3 py-1.5 md:max-w-[75%] dark:border-gray-700 dark:bg-gray-800">
            <div className="flex items-start gap-1.5">
              <GlyphIcon
                d={USER_STEERING_ICON}
                className="mt-1 shrink-0 text-gray-400 dark:text-gray-500"
              />
              <p className="wrap-anywhere whitespace-pre-wrap text-sm leading-relaxed text-gray-800 dark:text-gray-100">
                <span className="mr-1.5 text-xs font-semibold text-gray-500 dark:text-gray-400">
                  {S.chat.userSteering}
                </span>
                {steerText}
              </p>
            </div>
            {shown.length > 0 && (
              <div className="flex flex-wrap justify-end gap-1.5">
                {shown.map((src, i) => (
                  <ZoomableImage
                    key={i}
                    src={src}
                    alt={S.chat.imageAlt}
                    className="max-h-28 max-w-full rounded-md"
                  />
                ))}
              </div>
            )}
            {steerFiles.length > 0 && (
              <div className="flex justify-end">
                <AttachedFilesBanner files={steerFiles} />
              </div>
            )}
          </div>
          <MessageMeta
            {...(item.atMs !== undefined ? { atMs: item.atMs } : {})}
            text={steerText}
            align="right"
          />
        </div>
      );
    }
    case "user_image":
      return (
        <div className="anim-msg group my-4 flex flex-col items-end">
          <div className="max-w-[88%] rounded-lg bg-gray-100 p-1.5 md:max-w-[75%] dark:bg-gray-800">
            <ZoomableImage
              src={item.imageUrl}
              alt={S.chat.imageAlt}
              className="max-h-48 max-w-full rounded-md"
            />
          </div>
          <MessageMeta {...(item.atMs !== undefined ? { atMs: item.atMs } : {})} align="right" />
        </div>
      );
    case "assistant_text":
      // Doesn't attach MessageMeta: this turn's reply timestamp and copy both belong to the
      // stats line right below it (TaskStatsLine) — that line already serves as this reply's
      // footer, and rendering both would pop up two copy buttons in the same spot. The stats
      // line's copy grabs **all** of this turn's assistant text (see collectTaskAssistant),
      // which is more useful than copying segment by segment.
      return (
        <div className="md-body anim-msg my-3 text-base leading-relaxed text-gray-800 dark:text-gray-100">
          {/* Re-renders the accumulated text directly while streaming (a key point of the contract implementation); memoized so settled messages skip the re-parse, and code blocks highlight once on settle (see md.tsx). */}
          <Md text={item.text} streaming={item.streaming} />
          {item.streaming && <span className="animate-pulse text-gray-400">▌</span>}
          {item.stopReason && item.stopReason !== "completed" && (
            <span className="ml-1 font-mono text-xs text-gray-400">[{item.stopReason}]</span>
          )}
          {/* Nested models don't produce task_stats, so preserve their existing message-level file summaries. The root conversation renders one aggregated card from task_stats instead. */}
          {ctx.origin.length > 0 && !item.streaming && ctx.onOpenFile && ctx.statFiles && (
            <MessageFilesCard
              text={item.text}
              workspace={ctx.workspace ?? null}
              statFiles={ctx.statFiles}
              onOpenFile={ctx.onOpenFile}
            />
          )}
        </div>
      );
    case "thinking":
      return <ThinkingBlock item={item} />;
    case "tool_call":
      return <ToolCallCard item={item} ctx={ctx} />;
    case "subagent":
      // Standalone child session (no run_subagent card to bind to): same full-width shortcut
      // bar as the bound site — the conversation itself lives in the subagents panel.
      return (
        <div className="anim-msg my-2">
          <SubagentChip sessionId={item.sessionId} model={item.model} running={false} ctx={ctx} />
        </div>
      );
    case "abort":
      return (
        <p className="anim-msg my-1 font-mono text-xs text-gray-500 dark:text-gray-400">
          {S.chat.aborted(parseAbortReason(item.reason))}
        </p>
      );
    case "reconnect":
      return <ReconnectLine item={item} ctx={ctx} />;
    case "compaction":
      return <CompactionBanner item={item} />;
    case "mcp_connect":
      return <McpConnectBanner item={item} />;
    case "task_stats":
      return (
        <>
          {/* Root-session file references are a Task-level summary: task_stats is emitted only after the Task closes, and assistantText aggregates every assistant segment in that Task. */}
          {ctx.origin.length === 0 &&
            ctx.onOpenFile &&
            ctx.statFiles &&
            item.assistantText.trim() !== "" && (
              <MessageFilesCard
                text={item.assistantText}
                workspace={ctx.workspace ?? null}
                statFiles={ctx.statFiles}
                onOpenFile={ctx.onOpenFile}
              />
            )}
          {/* Memory changes sit below the file list: same Task-level summary, but sourced from
              the structured tool record (stream model) rather than the reply text, so it also
              renders when the reply never named the files. */}
          {ctx.origin.length === 0 && item.memoryChanges !== undefined && (
            <MemoryChangesCard
              rows={item.memoryChanges}
              {...(ctx.deletedMemoryKeys ? { deletedKeys: ctx.deletedMemoryKeys } : {})}
              {...(ctx.onLocateMemoryChange ? { onLocateChange: ctx.onLocateMemoryChange } : {})}
              {...(ctx.onOpenMemory ? { onOpenPanel: ctx.onOpenMemory } : {})}
            />
          )}
          <TaskStatsLine
            stats={item.stats}
            assistantText={item.assistantText}
            cost={item.stats ? (ctx.taskCost?.(item.stats) ?? null) : null}
            {...(item.atMs !== undefined ? { atMs: item.atMs } : {})}
            {...(ctx.origin.length === 0 && item.forkable && ctx.onFork
              ? { onFork: ctx.onFork }
              : {})}
            {...(item.forkPosition !== undefined ? { forkPosition: item.forkPosition } : {})}
          />
        </>
      );
  }
}
