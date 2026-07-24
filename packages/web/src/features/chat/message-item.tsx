/**
 * Rendering dispatch for a single view-model item: user prompts are
 * right-aligned brand bubbles (including image thumbnails), thinking collapsible blocks, text
 * streamed as Markdown, tool cards, subagent cards, compaction banners, abort markers, and Task
 * stats lines. Items have a light entrance animation.
 */
import { useState } from "react";
import { S } from "../../lib/strings";
import { useLocale } from "../../state/locale";
import { formatMessageTime } from "../../lib/format";
import { STAT_ICONS } from "../../lib/stat-icons";
import { splitImageAttachments } from "../../lib/attachments";
import type { ChatItem } from "../../lib/omni/stream-model";
import { Md } from "./md";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { ZoomableImage } from "../../components/ui/image-zoom";
import { MessageFilesCard } from "./message-files-card";
import { ThinkingBlock } from "./thinking-block";
import { ToolCallCard } from "./tool-call-card";
import { SubagentCard } from "./subagent-card";
import { CompactionBanner } from "./compaction-banner";
import { GoalRoundBanner } from "./goal-banner";
import { HandoffBanner } from "./handoff-banner";
import { ScheduledBanner } from "./scheduled-banner";
import { SkillsBanner } from "./skills-banner";
import { parseHandoffMessage, parseScheduledMessage } from "./agent-mentions";
import { parseGoalTaskMessage } from "./goal-use";
import { parseSkillsMessage } from "./skill-use";
import { TaskStatsLine } from "./task-stats-line";
import type { StreamRenderContext } from "./message-stream";

/** Duration the "Copied" tooltip stays visible (milliseconds). */
const COPIED_MS = 1200;

/**
 * Message footer: timestamp + copy. **Invisible but takes up space by default** (`opacity-0`
 * rather than `hidden`) — it surfaces on hovering the message list, and because the space is
 * always reserved, surfacing it never pushes content below it down (using `hidden` would cause
 * every item to jitter). Keyboard users can also reveal it via `focus-within` (otherwise the copy
 * button would be focusable but never visible).
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
  const [copied, setCopied] = useState(false);
  const copy = () => {
    if (text === undefined) return;
    void navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), COPIED_MS);
  };
  return (
    <div
      className={`flex h-5 items-center gap-2 opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-within:opacity-100 ${
        align === "right" ? "justify-end" : "justify-start"
      }`}
    >
      {atMs !== undefined && (
        <span className="text-[11px] text-gray-400">{formatMessageTime(atMs, locale)}</span>
      )}
      {text !== undefined && (
        <button
          type="button"
          title={copied ? S.chat.copied : S.chat.copyMessage}
          aria-label={S.chat.copyMessage}
          onClick={copy}
          className="rounded p-0.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
        >
          <GlyphIcon d={copied ? STAT_ICONS.check : STAT_ICONS.copy} />
        </button>
      )}
    </div>
  );
}

export function MessageItem({ item, ctx }: { item: ChatItem; ctx: StreamRenderContext }) {
  switch (item.kind) {
    case "user_text": {
      // Source block for a chat created via @ handoff: collapsed into a single-line handoff notice (the raw text isn't shown), clickable to jump back to the original chat.
      const handoff = parseHandoffMessage(item.text);
      if (handoff) return <HandoffBanner origin={handoff} />;
      // A goal round's injected input (the whole message is the <goal_task> block): collapsed
      // into a one-line round notice (the Trace page shows the raw block).
      const goalRound = parseGoalTaskMessage(item.text);
      if (goalRound) return <GoalRoundBanner round={goalRound.round} />;
      // Source block for a scheduled-task trigger: collapsed into a single-line notice, with the task's prompt body rendered as usual (verbatim on the Trace page).
      const scheduled = parseScheduledMessage(item.text);
      // Source block for a skill invocation: parsing continues on scheduled's remaining body
      // (handoff -> scheduled -> skills, blocks stripped in a chain); a match collapses into a
      // "using skill" banner, with the body rendered as usual.
      const afterScheduled = scheduled ? scheduled.rest : item.text;
      const skills = parseSkillsMessage(afterScheduled);
      // Attachment row restoration: for models that don't support images, input images are
      // written to disk as a path row; this pulls that out at render time and shows the actual
      // image. Mirrors the vision-model path (user_text + user_image as separate messages) in
      // shape: one bubble for the text, one bubble per image, styled the same as user_image.
      const { text, images } = splitImageAttachments(skills ? skills.rest : afterScheduled);
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
          {/* File summary card (Codex-style): aggregates file references in the text once streaming ends (lists only ones confirmed to exist). */}
          {!item.streaming && ctx.onOpenFile && ctx.statFiles && (
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
      return (
        <div className="anim-msg my-2">
          <SubagentCard sessionId={item.sessionId} model={item.model} running={false} ctx={ctx} />
        </div>
      );
    case "abort":
      return (
        <p className="anim-msg my-1 font-mono text-xs text-gray-500 dark:text-gray-400">
          {S.chat.aborted(item.reason)}
        </p>
      );
    case "reconnect":
      return (
        <p className="anim-msg my-1 font-mono text-xs text-amber-600 dark:text-amber-500">
          {S.chat.reconnect(
            item.status,
            item.gaveUp ? "gaveUp" : item.retrying ? "retried" : "waiting",
            item.attempt,
          )}
        </p>
      );
    case "compaction":
      return <CompactionBanner item={item} />;
    case "task_stats":
      return (
        <TaskStatsLine
          stats={item.stats}
          assistantText={item.assistantText}
          cost={item.stats ? (ctx.taskCost?.(item.stats) ?? null) : null}
          {...(item.atMs !== undefined ? { atMs: item.atMs } : {})}
        />
      );
  }
}
