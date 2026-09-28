/**
 * Create with AI: the path where you say what you want and an Agent builds it.
 *
 * It is one flow, told in four moments. The panel does not create anything — it writes a prompt
 * into a new Session's composer and leaves the sending to the reader — so what a reader sees in
 * the fold is exactly what goes out, their draft plus the fixed tail that says where the object
 * goes and what to confirm.
 *
 * - Prompt: the panel over the new Session, filled and handed over, and the proposal that comes
 *   back;
 * - Proposal: the Agent the model offers, in full — its instructions, its Skills, its model and
 *   how it asks before it acts;
 * - Review: one row per thing it would write, each accepted or still open;
 * - Created: where it landed, and the two ways on from there.
 *
 * Static stand-ins for W3's `Modal`, W4's `CreateButtons` and `Notice`, and W6's `Composer` and
 * changes card.
 */
import type { ReactNode } from "react";
import { fixturesFor } from "../fixtures";
import type { Fixtures } from "../fixtures";
import { APP_COLUMN_WIDTH, defineModule } from "../module";
import type { SceneSpec } from "../module";
import { at, reached, useScene } from "../scene";
import { AgentTile, DisclosureBody } from "../screens/parts";
import { UserBubble } from "../screens/transcript";
import {
  Backdrop,
  Badge,
  Button,
  Card,
  Count,
  GlyphIcon,
  IconButton,
  KeyValue,
  Modal,
  Notice,
  Presence,
  RunSpinner,
  StatusWord,
  StreamText,
  Text,
  TypingText,
  useFrameProgress,
} from "./parts";

const STAGE = "relative h-[34rem] overflow-hidden rounded-lg border border-line bg-canvas";

/**
 * How many of the review's rows the reader has already agreed to. The two files come from the
 * Agent's own words and read as settled; the two Skills are what a reader tends to argue with,
 * so they are the ones still open.
 */
const ACCEPTED = 2;

/** The Session the panel hands its prompt to: the chat, and the composer it lands in. */
function Chat({ f, draft, children }: { f: Fixtures; draft?: string; children?: ReactNode }) {
  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-2">
        <AgentTile id={f.agents[0]!.id} name={f.agents[0]!.name} size={16} />
        <h1 className="min-w-0 flex-1 truncate text-sm font-(--ui-weight-strong) text-fg">
          {f.copy.nav.newChat}
        </h1>
        <IconButton label={f.copy.common.more} icon="more" size="sm" />
      </header>
      <div className="min-h-0 flex-1 overflow-hidden px-6 py-4">
        <div className="mx-auto grid max-w-2xl grid-cols-[minmax(0,1fr)] gap-3">{children}</div>
      </div>
      <ComposerCard f={f} draft={draft} />
    </div>
  );
}

/** The Session's composer (W6: `Composer`): reading text, so it keeps the reading face. */
function ComposerCard({ f, draft }: { f: Fixtures; draft?: string }) {
  return (
    <div className="shrink-0 px-4 pb-4">
      <div className="mx-auto max-w-2xl rounded-lg border border-line-emphasis bg-surface px-3 py-2">
        <p
          className={`min-h-6 font-sans text-base leading-6 ${draft ? "text-fg" : "text-fg-subtle"}`}
        >
          {draft ?? f.copy.chat.inputPlaceholder}
        </p>
        <div className="mt-1 flex items-center gap-2">
          <GlyphIcon name="plus" size={16} className="text-fg-subtle" />
          <span className="min-w-0 flex-1" />
          <Button variant="primary" size="sm" leading={<GlyphIcon name="arrowUp" size={13} />}>
            {f.copy.chat.send}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * The panel: who will do the work, the draft, the examples that replace it, and the fold over
 * what is really sent. The draft and the fold type in step, because they are the same text — the
 * tail under it never changes, which is the point of showing it.
 */
function CreatePanel({ f }: { f: Fixtures }) {
  const clock = useScene();
  const p = f.createWithAi.panel;
  const agent = f.agents[0]!;
  const typed = reached(clock, "typing");
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3 px-5 py-2">
      <p className="flex items-center gap-1.5 text-sm text-fg-muted">
        <AgentTile id={agent.id} name={agent.name} size={16} />
        {p.runsAs(agent.name)}
      </p>
      <div className="min-h-20 rounded-md border border-line-emphasis bg-surface px-3 py-2">
        <p className={`font-sans text-sm leading-6 ${typed ? "text-fg" : "text-fg-subtle"}`}>
          {typed ? <TypingText text={p.draft} frame="typing" /> : p.placeholder}
          {typed && (
            <span aria-hidden className="ml-px inline-block h-4 w-px translate-y-0.5 bg-fg" />
          )}
        </p>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-1.5">
        <Text variant="eyebrow">{p.examplesLabel}</Text>
        <div className="grid grid-cols-3 gap-2">
          {p.examples.map((example) => (
            <span
              key={example.title}
              role="button"
              className="grid grid-cols-[minmax(0,1fr)] gap-1 rounded-md border border-line px-3 py-2"
            >
              <span className="truncate text-sm font-(--ui-weight-medium) text-fg">
                {example.title}
              </span>
              <span className="text-xs text-fg-muted">{example.description}</span>
            </span>
          ))}
        </div>
      </div>
      <DisclosureBody open={typed}>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-1.5 pt-1">
          <span className="flex items-center gap-1 text-xs text-fg-muted">
            <GlyphIcon name="chevronDown" size={12} />
            {p.previewLabel}
            <span className="min-w-0 flex-1" />
            <IconButton label={f.copy.common.copy} icon="copy" size="sm" />
          </span>
          <p className="max-h-24 overflow-hidden whitespace-pre-wrap rounded-md bg-surface-muted px-3 py-2 font-sans text-xs leading-5 text-fg-muted">
            <TypingText text={p.draft} frame="typing" />
            {"\n\n"}
            {p.tail}
          </p>
        </div>
      </DisclosureBody>
    </div>
  );
}

/** The Agent the model offers. `detail` is the card read on its own rather than in a reply. */
function ProposalCard({ f, detail = false }: { f: Fixtures; detail?: boolean }) {
  const c = f.createWithAi.proposal;
  const model = f.models.find((m) => m.isDefault) ?? f.models[0]!;
  return (
    <Card className="grid grid-cols-[minmax(0,1fr)] gap-3 px-4 py-3">
      <div className="flex items-start gap-3">
        <AgentTile id={c.agent.id} name={c.agent.name} size={28} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-(--ui-weight-medium) text-fg">{c.agent.name}</p>
          <p className="mt-0.5 text-sm text-fg-muted">{c.agent.description}</p>
        </div>
        <span className="shrink-0 font-mono text-xs text-fg-subtle">{c.agent.id}</span>
      </div>
      {detail && (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-1.5 border-t border-line-muted pt-3">
          <Text variant="eyebrow">{c.labels.instructions}</Text>
          <p className="font-sans text-sm leading-relaxed text-fg-muted">{c.agent.instructions}</p>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-fg-muted">{c.labels.skills}</span>
        {c.agent.skills.map((skill) => (
          <span
            key={skill}
            className="flex items-center gap-1 rounded-md border border-line px-1.5 py-0.5 font-mono text-xs text-fg-muted"
          >
            <GlyphIcon name="book" size={12} />
            {skill}
          </span>
        ))}
      </div>
      {detail && (
        <div className="border-t border-line-muted pt-3">
          <KeyValue
            columns={2}
            items={[
              { label: c.labels.model, value: model.displayName },
              {
                label: c.labels.approval,
                value: f.copy.chat.approvalModes[f.session.composer.approvalMode],
              },
            ]}
          />
        </div>
      )}
    </Card>
  );
}

/** The reply the panel's prompt draws: a line of prose, then the card it is about. */
function Reply({ f }: { f: Fixtures }) {
  const clock = useScene();
  const progress = useFrameProgress();
  const c = f.createWithAi.proposal;
  // The card lands once the line above it has been read, not the instant the frame turns over.
  const carded = reached(clock, "proposal") && (!at(clock, "proposal") || progress > 0.5);
  return (
    <>
      {at(clock, "sent") && (
        <span className="flex items-center gap-2 text-sm text-fg-muted">
          <RunSpinner />
          {f.copy.chat.thinking}
        </span>
      )}
      {reached(clock, "proposal") && (
        <p className="font-sans text-base leading-relaxed text-fg">
          <StreamText text={c.intro} frame="proposal" />
        </p>
      )}
      {carded && (
        <div data-reveal>
          <ProposalCard f={f} />
        </div>
      )}
    </>
  );
}

const PROMPT_SCENE: SceneSpec = {
  frames: [
    { key: "empty", title: "Empty", hold: 900 },
    { key: "typing", title: "Typing", hold: 2200 },
    { key: "sent", title: "Sent", hold: 1200 },
    { key: "proposal", title: "Proposal", hold: 3400 },
  ],
};

/**
 * Prompt: the panel opens over a Session with nothing in it; the draft is typed and the fold
 * under it grows to show the draft and the tail it will be sent with; the panel leaves and the
 * whole prompt is the Session's first message; the reply streams in and the proposal lands.
 */
function Prompt({ f }: { f: Fixtures }) {
  const clock = useScene();
  const p = f.createWithAi.panel;
  const sent = reached(clock, "sent");
  const open = !sent;
  return (
    <div className={STAGE}>
      <div className="h-full overflow-hidden">
        <Chat f={f}>
          {sent && <UserBubble item={{ text: `${p.draft}\n\n${p.tail}` }} dense={false} />}
          {sent && <Reply f={f} />}
        </Chat>
      </div>
      <Backdrop show={open} />
      <div className="absolute inset-0 flex items-start justify-center px-6 py-8">
        <Presence show={open} side="center" className="w-full max-w-xl">
          <Modal
            title={f.copy.agents.aiCreateTitle}
            footer={
              <>
                <Button variant="secondary" size="sm">
                  {f.copy.common.cancel}
                </Button>
                <Button variant="primary" size="sm">
                  {p.open}
                </Button>
              </>
            }
          >
            <CreatePanel f={f} />
          </Modal>
        </Presence>
      </div>
    </div>
  );
}

/** Proposal: the card read on its own, with everything it would write down. */
function Proposal({ f }: { f: Fixtures }) {
  const c = f.createWithAi.proposal;
  return (
    <div className={STAGE}>
      <Chat f={f}>
        <p className="font-sans text-base leading-relaxed text-fg">{c.intro}</p>
        <ProposalCard f={f} detail />
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1" />
          <Button variant="secondary" size="sm" leading={<GlyphIcon name="pencil" size={13} />}>
            {f.copy.common.edit}
          </Button>
          <Button variant="primary" size="sm">
            {c.accept}
          </Button>
        </div>
      </Chat>
    </div>
  );
}

/**
 * What the creation would write, one row each (W6: `ChangesCard`). The head's mark names the rows
 * under it and says nothing its title does not, so it takes `ui-icon-decor` and a theme may tint
 * it or drop it; the kind badges and the accepted marks carry state, so they stay everywhere.
 */
function ChangesCard({ f }: { f: Fixtures }) {
  const r = f.createWithAi.review;
  const pencil = <GlyphIcon name="pencil" size={12} />;
  return (
    <Card className="grid grid-cols-[minmax(0,1fr)] overflow-hidden">
      <div className="flex items-center gap-2 border-b border-line px-4 py-2">
        <GlyphIcon name="fileText" size={14} decor="group" className="text-fg-subtle" />
        <p className="min-w-0 flex-1 text-sm font-(--ui-weight-medium) text-fg">
          {r.title(r.changes.length)}
        </p>
        <Count n={r.changes.length} />
      </div>
      <ul className="divide-y divide-line-muted">
        {r.changes.map((change, i) => (
          <li key={change.path} className="flex items-start gap-3 px-4 py-2.5">
            <Badge tone={change.kind === "new" ? "success" : "info"} variant="outline">
              {r.kinds[change.kind]}
            </Badge>
            <div className="min-w-0 flex-1">
              <p className="truncate font-mono text-xs text-fg">{change.path}</p>
              <p className="mt-0.5 text-sm text-fg-muted">{change.note}</p>
            </div>
            {i < ACCEPTED ? (
              <StatusWord tone="success" icon="check">
                {r.accepted}
              </StatusWord>
            ) : (
              <Button variant="ghost" size="xs" leading={pencil}>
                {f.copy.common.edit}
              </Button>
            )}
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-2 border-t border-line px-4 py-2.5">
        <span className="min-w-0 flex-1" />
        <Button variant="secondary" size="sm">
          {f.copy.common.cancel}
        </Button>
        <Button variant="primary" size="sm">
          {r.confirm}
        </Button>
      </div>
    </Card>
  );
}

/** Review: what it would write, one row at a time, each one still yours to change. */
function Review({ f }: { f: Fixtures }) {
  return (
    <div className={STAGE}>
      <Chat f={f}>
        <ChangesCard f={f} />
      </Chat>
    </div>
  );
}

/** Created: what was written, where it went, and the two ways on from here. */
function Created({ f }: { f: Fixtures }) {
  const c = f.createWithAi;
  return (
    <div className={STAGE}>
      <Chat f={f}>
        <Notice tone="success" title={c.created.title(c.proposal.agent.name)}>
          {c.created.body}
        </Notice>
        <ProposalCard f={f} />
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-fg-muted">
            {c.created.path}
          </span>
          <Button variant="secondary" size="sm">
            {c.created.open}
          </Button>
          <Button variant="primary" size="sm" leading={<GlyphIcon name="newChat" size={13} />}>
            {c.created.start}
          </Button>
        </div>
      </Chat>
    </div>
  );
}

const VARIANTS = {
  prompt: Prompt,
  proposal: Proposal,
  review: Review,
  created: Created,
} as const;

export const module = defineModule({
  id: "create-with-ai",
  title: "Create with AI",
  description:
    "Describe what you want and an Agent builds it: the panel that hands a prompt to a new Session, the Agent it proposes, what it would write, and where it landed.",
  width: "wide",
  viewport: APP_COLUMN_WIDTH,
  variants: [
    { key: "prompt", title: "Prompt", kind: "animated", scene: PROMPT_SCENE },
    { key: "proposal", title: "Proposal", kind: "static" },
    { key: "review", title: "Review", kind: "static" },
    { key: "created", title: "Created", kind: "static" },
  ],
  parts: [
    "chat-message-bubble",
    "chat-assistant-text",
    "chat-changes-card",
    "chat-composer",
    "actions-create-buttons",
    "actions-button",
    "feedback-badge",
    "feedback-count",
    "feedback-notice",
    "overlays-modal",
    "data-key-value",
    "layout-card",
  ],
  render: (variant, { lang }) => {
    const View = VARIANTS[variant as keyof typeof VARIANTS] ?? Prompt;
    return <View f={fixturesFor(lang)} />;
  },
});
