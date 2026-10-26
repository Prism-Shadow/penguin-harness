/**
 * Rendering dispatch for a single view-model item: user prompts are right-aligned bubbles with
 * the images and files they carried above them, thinking collapsible blocks, text streamed as
 * Markdown, tool cards, subagent cards, compaction banners, abort markers, and Task stats lines.
 * Items have a light entrance animation.
 *
 * The drawing is the UI package's (MessageRow / MessageBubble / MessageAttachments / MessageMeta
 * and the attachment tiles for what the person sent and the run's notice lines, AssistantText for
 * a reply); what stays here is which item becomes what, the text parsing that collapses harness
 * blocks into banners, what the model request's retry row says and offers (the UI package's
 * shared retry row), and the Retry a failed or stopped run's last line offers.
 */
import { useState } from "react";
import {
  AssistantText,
  AttachmentFile,
  AttachmentImage,
  AttachmentList,
  Button,
  MessageAttachments,
  MessageBubble,
  MessageMeta,
  MessageRow,
  RetryStatus,
  useCountdown,
} from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { useLocale } from "../../state/locale";
import { formatMessageTime } from "../../lib/format";
import { attachmentFileName, splitAttachments } from "../../lib/attachments";
import { routedUrl } from "../../lib/session-machines";
import type { ChatItem, ReconnectItem } from "../../lib/amsp/stream-model";
import { MessageFilesCard } from "./message-files-card";
import { MemoryChangesCard } from "./memory-changes-card";
import { requestRetryRow } from "./request-retry-row";
import { SessionThinking } from "./thinking-block";
import { SessionToolCall } from "./tool-call-card";
import { SessionSubagentChip } from "./subagent-chip";
import { CompactionBanner } from "./compaction-banner";
import { McpConnectBanner } from "./mcp-connect-banner";
import { HandoffBanner, ModelSwitchBanner } from "./handoff-banner";
import { ScheduledBanner } from "./scheduled-banner";
import { OrgTriggerBanner } from "./org-trigger-banner";
import { parseOrgTriggerMessage } from "./org-trigger";
import { SkillsBanner } from "./skills-banner";
import { BackgroundDoneBanner } from "./background-done-banner";
import { HarnessInjectedBanner } from "./harness-banner";
import {
  parseBackgroundTaskDoneMessage,
  parseHandoffMessage,
  parseModelSwitchMessage,
  parseScheduledMessage,
} from "./agent-handoff";
import { parseSkillsMessage } from "./skill-use";
import { TaskStatsLine } from "./task-stats-line";
import type { StreamRenderContext } from "./message-stream";

/**
 * The footer under a message the person sent (MessageMeta): its time in the reader's locale, and
 * a copy button when there is text to copy — none for an image or a files notice, where copying
 * has no clear meaning. The same hover reveal as the reply's stats footer, and always shown below
 * sm, where touch has no hover.
 */
function SentMessageMeta({ atMs, copyText }: { atMs: number | undefined; copyText?: string }) {
  const { locale } = useLocale();
  return (
    <MessageMeta
      {...(atMs !== undefined ? { time: formatMessageTime(atMs, locale) } : {})}
      {...(copyText !== undefined ? { copy: { text: copyText, label: S.chat.copyMessage } } : {})}
    />
  );
}

/**
 * The images and files a message carried, as the composer showed them: the images as tiles in
 * one row, the files as tiles in the next. `size` is the images' — `md` above a prompt's text,
 * `sm` inside a steer's chip, where both share one row as they did in the composer. A sent file
 * is named by its scratchpad file name; its bytes stay there for the model to open by path.
 */
function SentAttachments({
  images,
  files,
  size,
}: {
  images: readonly string[];
  files: readonly string[];
  size: "sm" | "md";
}) {
  const imageTiles = images.map((src, i) => (
    <AttachmentImage
      key={`image-${i}`}
      src={src}
      alt={S.chat.imageAlt}
      size={size}
      lazy
      unavailableLabel={S.chat.imageUnavailable}
    />
  ));
  const fileTiles = files.map((path, i) => (
    <AttachmentFile key={`file-${i}`} name={attachmentFileName(path)} />
  ));
  if (size === "sm") {
    return (
      <AttachmentList>
        {imageTiles}
        {fileTiles}
      </AttachmentList>
    );
  }
  return (
    <MessageAttachments>
      {imageTiles.length > 0 && <AttachmentList align="end">{imageTiles}</AttachmentList>}
      {fileTiles.length > 0 && <AttachmentList align="end">{fileTiles}</AttachmentList>}
    </MessageAttachments>
  );
}

/** Countdown floor: waits shorter than this keep the plain sending text (sub-second flashes of numbers are noise). */
const COUNTDOWN_MIN_MS = 2000;

/**
 * The Retry the line a run ended on offers (the fatal error banner, a reconnect line that gave
 * up, or the stop marker), or undefined for none: only on the main conversation (a subagent's
 * run belongs to the child session, which the retry route does not target), only on the stream's
 * last item (anything after it has already resent the unfinished turn's input) and only while no
 * Task runs.
 */
function retryOffer(ctx: StreamRenderContext, last: boolean): StreamRenderContext["onRetry"] {
  return last && ctx.origin.length === 0 && !ctx.taskRunning ? ctx.onRetry : undefined;
}

/**
 * "Retry" on the error banner or the stop marker a run ended on (a retry row that gave up offers
 * its own, as a link). A click disables it, and it stays disabled: the Task starting, or anything
 * landing after the line, takes the button away (and with it this state). A refused retry enables
 * it again — the page has already said why.
 */
function RetryRunButton({ onRetry }: { onRetry: () => Promise<void> }) {
  const [acted, setActed] = useState(false);
  return (
    <Button
      variant="secondary"
      size="xs"
      disabled={acted}
      onClick={() => {
        setActed(true);
        void onRetry().catch(() => setActed(false));
      }}
    >
      {S.chat.retryRun}
    </Button>
  );
}

/**
 * The model request's retry row, one per ladder (request-retry-row.ts says what it reads): a live
 * countdown when the engine announced its planned wait (request_end.retry_in_ms ≥ 2s — with the
 * exponential ladder a wait can reach 30s, and a static line reads as a hang), anchored on the
 * CLIENT arrival time of the event (skew-free), whole seconds on the page's one second-aligned
 * clock. While it runs, two presses: "Retry now" (skips the remaining backoff server-side; the
 * row flips once the request_begin arrives — no optimistic state beyond holding the presses) and
 * "Stop retrying" (the ordinary session abort; the engine's abort-during-backoff path ends the
 * turn and re-enables the composer). The presses belong to ONE attempt: a ladder reuses this
 * component across all of them (the item keeps its id through the collapse, see stream-model's
 * continuedLadder), and the attempt is part of the key that re-arms them, so one press never
 * leaves a later attempt with dead controls. History safety: replay delivers the following
 * request_begin/abort immediately, flipping the state, so neither the countdown nor the presses
 * render for replayed items; the presses are additionally main-session-only (a subagent's
 * backoff belongs to the child session, which the retry-now route does not target). A row that
 * gave up ended the run, and as the stream's last item it offers Retry (see retryOffer).
 */
function ReconnectLine({
  item,
  ctx,
  last,
}: {
  item: ReconnectItem;
  ctx: StreamRenderContext;
  last: boolean;
}) {
  const target =
    !item.gaveUp &&
    !item.retrying &&
    item.plannedDelayMs !== undefined &&
    item.plannedDelayMs >= COUNTDOWN_MIN_MS &&
    item.arrivedAtMs !== undefined
      ? item.arrivedAtMs + item.plannedDelayMs
      : null;
  const left = useCountdown(target);
  const main = ctx.origin.length === 0;
  return (
    <div className="anim-msg my-1">
      <RetryStatus
        {...requestRetryRow(item, left !== null && left > 0 ? target : null, {
          onRetryNow: main ? ctx.onRetryNow : undefined,
          onStop: main ? ctx.onGiveUp : undefined,
          onRetry: item.gaveUp ? retryOffer(ctx, last) : undefined,
        })}
      />
    </div>
  );
}

export function MessageItem({
  item,
  ctx,
  last = false,
  images: followingImages = [],
}: {
  item: ChatItem;
  ctx: StreamRenderContext;
  /**
   * Whether this is the stream's last item (only the ended Task's stats row may follow it): the
   * line a run ended on offers Retry only then.
   */
  last?: boolean;
  /**
   * A prompt's images that arrived as image items right behind it (`user_text` / `user_image`):
   * drawn with it, in one row above its text. Inline bytes live, or a windowed history page's
   * reference to the Trace record, fetched from the machine the Session lives on.
   */
  images?: readonly string[];
}) {
  switch (item.kind) {
    case "user_text": {
      // Harness-injected completion notice of a run_in_background task: collapsed into a
      // one-line banner with the report body below it (the raw block shows on the Trace page).
      // Checked before the generic harness card: the notice carries the same stamp.
      const backgroundDone = parseBackgroundTaskDoneMessage(item.text);
      if (backgroundDone) {
        return <BackgroundDoneBanner done={backgroundDone.done} body={backgroundDone.rest} />;
      }
      // Any other harness-injected input (a goal round's protocol, a hook's continue or
      // expansion context): a compact collapsed card, not a user bubble — nothing in it was typed.
      if (item.sender === "harness") return <HarnessInjectedBanner text={item.text} />;
      // Source block for a chat created via the /agent handoff: collapsed into a single-line handoff notice (the raw text isn't shown), clickable to jump back to the original chat.
      const handoff = parseHandoffMessage(item.text);
      if (handoff) return <HandoffBanner origin={handoff} />;
      // Source block for a chat opened by the /model switch: collapsed into a single-line switch notice, clickable to jump back to the source conversation.
      const modelSwitch = parseModelSwitchMessage(item.text);
      if (modelSwitch) return <ModelSwitchBanner origin={modelSwitch} />;
      // Source block for an organization trigger (a desk or ticket session's work run):
      // collapsed into a single-line notice like the scheduled banner, the trigger body
      // rendered as usual. A message carries at most one origin block, so the chain simply
      // continues on whatever this leaves.
      const orgTrigger = parseOrgTriggerMessage(item.text);
      const afterOrgTrigger = orgTrigger ? orgTrigger.rest : item.text;
      // Source block for a scheduled-task trigger: collapsed into a single-line notice, with the task's prompt body rendered as usual (verbatim on the Trace page).
      const scheduled = parseScheduledMessage(afterOrgTrigger);
      // Source block for a skill invocation: parsing continues on scheduled's remaining body
      // (scheduled -> skills, blocks stripped in a chain); a match collapses into a
      // "using skill" banner, with the body rendered as usual.
      const afterScheduled = scheduled ? scheduled.rest : afterOrgTrigger;
      const skills = parseSkillsMessage(afterScheduled);
      // Attachment row restoration (last in the chain — these lines trail the body rather than
      // prefixing it): for models that don't support images, input images are written to disk
      // as a path row; this pulls that out at render time and shows the actual image. The
      // vision-model path delivers them as image items behind the text instead (`images`); both
      // draw the same row of tiles above the text, and uploaded files, which come out of the
      // same pass, the row of file tiles under it — the pieces the composer showed. The files'
      // bytes live in the session scratchpad, where the model opens them by path (goal mode
      // never gets here: it takes text and images only).
      const { text, images, files } = splitAttachments(skills ? skills.rest : afterScheduled);
      const shown = [...images, ...followingImages.map(routedUrl)];
      const carried = shown.length > 0 || files.length > 0;
      return (
        <>
          {orgTrigger && <OrgTriggerBanner origin={orgTrigger.origin} />}
          {scheduled && <ScheduledBanner origin={scheduled.origin} />}
          {skills && <SkillsBanner names={skills.skills} />}
          {(text || carried) && (
            <MessageRow>
              {carried && <SentAttachments images={shown} files={files} size="md" />}
              {text && <MessageBubble variant="user">{text}</MessageBubble>}
              <SentMessageMeta atMs={item.atMs} {...(text ? { copyText: text } : {})} />
            </MessageRow>
          )}
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
      // [attached file: …] rows (there is no item.files channel) and become the same file tiles
      // a full prompt shows, in the chip's one row after the images — a files-only steering
      // would otherwise render as an empty chip with the filenames lost.
      const {
        text: steerText,
        images: steerImages,
        files: steerFiles,
      } = splitAttachments(item.text);
      // A steer's own images can be a history page's Trace references: routed to the
      // Session's machine like the user_image below.
      const shown = [...steerImages, ...(item.images ?? []).map(routedUrl)];
      return (
        <MessageRow spacing="steer">
          <MessageBubble
            variant="steering"
            label={S.chat.userSteering}
            {...(shown.length > 0 || steerFiles.length > 0
              ? { attachments: <SentAttachments images={shown} files={steerFiles} size="sm" /> }
              : {})}
          >
            {steerText}
          </MessageBubble>
          <SentMessageMeta atMs={item.atMs} copyText={steerText} />
        </MessageRow>
      );
    }
    case "user_image":
      // A prompt with no text: its first image, with the ones behind it. Inline bytes live, or
      // a windowed history page's reference to the Trace record
      // (`/api/sessions/<id>/trace-image?…`), which the browser must fetch from the machine the
      // Session lives on.
      return (
        <MessageRow>
          <SentAttachments
            images={[item.imageUrl, ...followingImages].map(routedUrl)}
            files={[]}
            size="md"
          />
          <SentMessageMeta atMs={item.atMs} />
        </MessageRow>
      );
    case "assistant_text":
      // Doesn't attach MessageMeta: this turn's reply timestamp and copy both belong to the
      // stats line right below it (TaskStatsLine) — that line already serves as this reply's
      // footer, and rendering both would pop up two copy buttons in the same spot. The stats
      // line's copy grabs **all** of this turn's assistant text (see collectTaskAssistant),
      // which is more useful than copying segment by segment.
      // The body (Markdown, caret, the theme's reveal) is AssistantText; a nested reply's files
      // card follows the text once it is fully revealed. How the Request ended is not the
      // text's to say: the retry line, error banner or stop marker that follows says it.
      return (
        <AssistantText text={item.text} streaming={item.streaming}>
          {/* Nested models don't produce task_stats, so preserve their existing message-level file summaries. The root conversation renders one aggregated card from task_stats instead. */}
          {ctx.origin.length > 0 && !item.streaming && ctx.onOpenFile && ctx.statFiles && (
            <MessageFilesCard
              text={item.text}
              workspace={ctx.workspace ?? null}
              statFiles={ctx.statFiles}
              onOpenFile={ctx.onOpenFile}
            />
          )}
        </AssistantText>
      );
    case "thinking":
      return <SessionThinking item={item} />;
    case "tool_call":
      return <SessionToolCall item={item} ctx={ctx} />;
    case "subagent":
      // Standalone child session (no run_subagent card to bind to): same full-width shortcut
      // bar as the bound site — the conversation itself lives in the subagents panel.
      return (
        <div className="anim-msg my-2">
          <SessionSubagentChip
            sessionId={item.sessionId}
            model={item.model}
            running={false}
            ctx={ctx}
          />
        </div>
      );
    case "abort": {
      // A stopped run holds its unfinished turn just as a failed one does, so its marker offers
      // the same Retry.
      const retry = retryOffer(ctx, last);
      return (
        <MessageBubble
          variant="notice"
          actions={retry ? <RetryRunButton onRetry={retry} /> : undefined}
        >
          {S.chat.aborted(item)}
        </MessageBubble>
      );
    }
    case "llm_error": {
      const retry = retryOffer(ctx, last);
      return (
        <MessageBubble
          variant="notice"
          actions={retry ? <RetryRunButton onRetry={retry} /> : undefined}
        >
          {S.chat.llmError(item.errorMessage)}
        </MessageBubble>
      );
    }
    case "reconnect":
      return <ReconnectLine item={item} ctx={ctx} last={last} />;
    case "compaction":
      return <CompactionBanner item={item} />;
    case "model_change": {
      // A slim divider between two contexts on different models (an in-session model switch),
      // named by model id: it renders from the Trace alone, so a model removed from the
      // configuration since still reads. One id under two providers is told apart by the pair.
      const sameId = item.from.modelId === item.to.modelId;
      const name = (m: { provider: string; modelId: string }): string =>
        sameId ? `${m.provider} / ${m.modelId}` : m.modelId;
      return (
        <div className="anim-msg my-3 flex items-center gap-3 text-xs text-fg-muted">
          <span aria-hidden className="h-px flex-1 bg-line" />
          <span className="min-w-0 break-words text-center">
            {S.chat.modelChanged(name(item.from), name(item.to))}
          </span>
          <span aria-hidden className="h-px flex-1 bg-line" />
        </div>
      );
    }
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
            cost={item.stats ? (ctx.taskCost?.(item.stats, item.model) ?? null) : null}
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
