/**
 * A channel's header, above its stream: the name (the localized label for the all-hands
 * channel, never its stored name) with the "?" that says what kind of channel this is and how
 * far an @-chain relays, the channel's own purpose beside it — nothing when the all-hands
 * channel has none, since what that channel is for is in the "?" — the members as a stack of
 * avatars opening a member popover — an employee row there opens its desk session — and the
 * actions: invite, leave, and the overflow menu with rename, purpose, archive and unarchive.
 *
 * Who may do what is the server's rule, not this file's: everything here is shown to a
 * person, who is a Project member and therefore may join, archive and unarchive — and may
 * invite once it is in the channel itself. The all-hands channel is the one exception the UI
 * itself enforces — it cannot be left, archived, or have its membership edited, so those
 * controls are simply absent, the missing archive row named by one muted line in the menu.
 * What that channel is stays in the header's "?", said once.
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router";
import type { OrgChannelDetail, OrgChannelMember } from "@prismshadow/penguin-server/api";
import {
  AgentAvatar,
  AvatarStack,
  Button,
  ConfirmModal,
  Dropdown,
  GlyphIcon,
  Heading,
  ICONS,
  ICON_GAP,
  ICON_SIZE,
  InfoPopover,
  Input,
  Menu,
  MenuItem,
  UserAvatar,
  menuPanelClass,
  noAutofill,
  toastError,
  toastSuccess,
  usePortalPanel,
} from "@prismshadow/penguin-ui";
import type { AvatarStackItem } from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { useProject } from "../../state/project";
import { Truncated } from "../../components/ui/truncated";
import { ChannelTextDialog } from "./channel-dialogs";
import { channelGlyph } from "./channel-sidebar";
import { channelLabel, inviteCandidates, isAllHands } from "./channel-list";
import type { InviteCandidate } from "./channel-list";
import { parsePrincipal } from "./principals";

/** Invite (lucide user-plus): the header's "add somebody to this channel" action. */
const INVITE_ICON =
  "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0zM19 8v6M22 11h-6";

/** Leave (lucide log-out): removing oneself from the channel. */
const LEAVE_ICON = "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9";

/** Purpose (lucide text): the menu row that edits what the channel is for. */
const PURPOSE_ICON = "M4 6h16M4 12h12M4 18h8";

/** Opening a desk session (lucide door-open): the member popover's employee rows, and the org chart's node menu. */
export const DESK_ICON = "M13 4h3v16h-3M3 20h11V4L3 6zM10 12h.01";

/** Members shown as avatars before the count takes over. */
const AVATAR_STACK = 3;

const PANEL_WIDTH = 288;

/** One member as an avatar: an employee's tile keyed by its agent id, a person's initial disc. */
function memberAvatarItem(member: OrgChannelMember): AvatarStackItem {
  const parsed = parsePrincipal(member.principal);
  return parsed.kind === "agent"
    ? { id: parsed.id, name: member.name }
    : {
        id: parsed.kind === "user" ? parsed.id : member.principal,
        name: member.name,
        kind: "user",
      };
}

/** One member's avatar: an employee's tile, a person's initial disc. */
function MemberAvatar({ member, size }: { member: OrgChannelMember; size: number }) {
  const item = memberAvatarItem(member);
  if (item.kind === "user") {
    return <UserAvatar userId={item.id} displayName={item.name} size={size} />;
  }
  return <AgentAvatar id={item.id} name={item.name} size={size} className="shrink-0 rounded" />;
}

/** The member list: who is in the channel, with an employee's desk session one click away. */
function MemberPopover({
  members,
  onOpenDesk,
  openingDesk,
}: {
  members: readonly OrgChannelMember[];
  /** Opens an employee's desk session; takes the member's principal. */
  onOpenDesk: (principal: string) => void;
  /** The principal whose desk is being opened, so the rows do not fire twice. */
  openingDesk: string | null;
}) {
  const [open, setOpen] = useState(false);
  const { triggerRef, panelRef, position } = usePortalPanel({
    open,
    onClose: () => setOpen(false),
    estimatedHeight: Math.min(320, members.length * 32 + 24),
    panelWidth: PANEL_WIDTH,
  });
  const label = `${S.company.channels.memberList} · ${S.company.channels.memberCount(members.length)}`;
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        data-tooltip={label}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-xs text-gray-600 transition-colors duration-150 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-gray-100"
      >
        {/* The first few only: the count beside the stack already says how many there are. */}
        <AvatarStack
          items={members.slice(0, AVATAR_STACK).map(memberAvatarItem)}
          size={ICON_SIZE.groupHeaderAvatar}
        />
        <span className="tabular-nums">{S.company.channels.memberCount(members.length)}</span>
      </button>
      {open &&
        position &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label={S.company.channels.memberList}
            style={{
              position: "fixed",
              top: position.topPx,
              bottom: position.bottomPx,
              left: position.left,
              width: PANEL_WIDTH,
            }}
            className={`${menuPanelClass} z-[60] max-h-[60vh]`}
          >
            {members.length === 0 ? (
              <p className="px-2.5 py-1.5 text-xs text-gray-400 dark:text-gray-500">
                {S.company.channels.memberCount(0)}
              </p>
            ) : (
              members.map((m) => (
                <div
                  key={m.principal}
                  className={`flex items-center ${ICON_GAP.row} px-2.5 py-1.5 text-xs`}
                >
                  <MemberAvatar member={m} size={ICON_SIZE.rowLead} />
                  <Truncated text={m.name} className="min-w-0 flex-1" />
                  {m.kind === "agent" && (
                    <Button
                      variant="ghost"
                      size="xs"
                      className="shrink-0"
                      disabled={openingDesk !== null}
                      onClick={() => onOpenDesk(m.principal)}
                      leading={<GlyphIcon d={DESK_ICON} size={ICON_SIZE.inlineGlyph} />}
                    >
                      {S.company.openDesk}
                    </Button>
                  )}
                </div>
              ))
            )}
          </div>,
          document.body,
        )}
    </>
  );
}

/** The invite picker: everyone not in the channel yet, filtered by what is typed. */
function InvitePicker({
  candidates,
  query,
  onQuery,
  onPick,
  busy,
}: {
  candidates: readonly InviteCandidate[];
  query: string;
  onQuery: (value: string) => void;
  onPick: (candidate: InviteCandidate) => void;
  busy: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dropdown
      open={open}
      setOpen={(v) => {
        setOpen(v);
        if (!v) onQuery("");
      }}
      portal={{ direction: "down", align: "right" }}
      menuClass="w-72"
      className="shrink-0"
      button={
        <Button size="sm" onClick={() => setOpen(!open)} disabled={busy}>
          {S.company.channels.invite}
        </Button>
      }
    >
      <div role="dialog" aria-label={S.company.channels.inviteTitle}>
        <div className="px-2 pb-1 pt-1.5">
          <Input
            size="sm"
            value={query}
            aria-label={S.company.channels.inviteSearch}
            placeholder={S.company.channels.inviteSearch}
            {...noAutofill}
            onChange={(e) => onQuery(e.target.value)}
          />
        </div>
        <div className="max-h-64 overflow-y-auto">
          {candidates.length === 0 ? (
            <p className="px-2.5 py-1.5 text-xs text-gray-400 dark:text-gray-500">
              {S.company.channels.inviteEmpty}
            </p>
          ) : (
            candidates.map((c) => (
              <MenuItem
                key={c.principal}
                density="sm"
                disabled={busy}
                onSelect={() => {
                  setOpen(false);
                  onQuery("");
                  onPick(c);
                }}
                glyph={
                  <MemberAvatar
                    member={{ principal: c.principal, name: c.name, kind: c.kind }}
                    size={ICON_SIZE.rowLead}
                  />
                }
                label={c.name}
                trailing={c.detail ?? (c.kind === "user" ? S.company.channels.members : "")}
              />
            ))
          )}
        </div>
      </div>
    </Dropdown>
  );
}

export function ChannelHeader({
  projectId,
  orgId,
  me,
  detail,
  employees,
  projectMembers,
  onChanged,
}: {
  projectId: string;
  orgId: string;
  /** The reader's own principal (`user:<id>`) — what leaving removes. */
  me: string;
  /** The channel as the server last described it, members included; null while it loads. */
  detail: OrgChannelDetail | null;
  employees: ReadonlyArray<{ agentId: string; name: string; title: string }>;
  projectMembers: readonly string[];
  /** Re-read the channel (and the sidebar's listing) after a write. */
  onChanged: () => void;
}) {
  const navigate = useNavigate();
  const { setCurrentAgentId } = useProject();
  const [renameOpen, setRenameOpen] = useState(false);
  const [purposeOpen, setPurposeOpen] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [openingDesk, setOpeningDesk] = useState<string | null>(null);

  // A channel switch must not leave the previous one's dialogs standing.
  const channelId = detail?.channelId ?? null;
  useEffect(() => {
    setRenameOpen(false);
    setPurposeOpen(false);
    setLeaveOpen(false);
    setArchiveOpen(false);
    setMenuOpen(false);
    setQuery("");
  }, [channelId]);

  if (detail === null) {
    return (
      <div className="flex h-12 shrink-0 items-center border-b border-gray-200 px-3 md:px-4 dark:border-gray-800" />
    );
  }

  const allHands = isAllHands(detail.channelId);
  const label = channelLabel(detail, S.company.channels.allHands);
  // The subtitle is the channel's own purpose and nothing else. The all-hands channel is seeded
  // without one and stays blank until somebody writes one: what it is for is the kind of channel
  // it is, which is the "?" beside the name, and standing text there would be a sentence the
  // reader re-reads on every visit to a channel it can never change. An invited channel without
  // a purpose says so instead, because writing one is a menu row away.
  const purpose =
    detail.purpose !== "" ? detail.purpose : allHands ? null : S.company.channels.purposeEmpty;
  const candidates = inviteCandidates(employees, projectMembers, detail.members, query);

  const openDesk = async (principal: string) => {
    const parsed = parsePrincipal(principal);
    if (parsed.kind !== "agent" || openingDesk !== null) return;
    const agentId = parsed.id;
    setOpeningDesk(principal);
    try {
      const desk = await api.getOrgDesk(projectId, orgId, agentId);
      setCurrentAgentId(agentId);
      navigate(`/chat/${desk.sessionId}`);
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setOpeningDesk(null);
    }
  };

  const invite = async (candidate: InviteCandidate) => {
    setBusy(true);
    try {
      await api.addOrgChannelMember(projectId, orgId, detail.channelId, {
        principal: candidate.principal,
      });
      toastSuccess(S.company.channels.invited(candidate.name));
      onChanged();
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  const leave = async (principal: string) => {
    setBusy(true);
    try {
      await api.removeOrgChannelMember(projectId, orgId, detail.channelId, principal);
      setLeaveOpen(false);
      toastSuccess(S.company.channels.left);
      onChanged();
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  const setArchived = async (archived: boolean) => {
    setBusy(true);
    try {
      await api.patchOrgChannel(projectId, orgId, detail.channelId, { archived });
      setArchiveOpen(false);
      toastSuccess(archived ? S.company.channels.archived : S.company.channels.unarchived);
      onChanged();
    } catch (e) {
      toastError(apiErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  const patchText = async (body: { name?: string; purpose?: string }) => {
    await api.patchOrgChannel(projectId, orgId, detail.channelId, body);
    setRenameOpen(false);
    setPurposeOpen(false);
    toastSuccess(S.common.saved);
    onChanged();
  };

  return (
    <>
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-gray-200 px-3 py-2 md:px-4 dark:border-gray-800">
        <div className="flex min-w-0 flex-1 items-baseline gap-x-3 gap-y-1">
          {/* The name is a direct child of the heading, with the "?" right after it — the
              anchoring every other title in the app uses (OrgPage's own header included), and
              what test/disclosure-anchor.test.ts reads. The page's one h1, set on the h4 rung:
              a header row's title, not a page's display title. The row clips rather than wraps:
              the server caps a channel name at 100 characters and the tooltip carries it whole. */}
          <Heading
            level={4}
            as="h1"
            data-tooltip={label}
            className={`flex min-w-0 items-center overflow-hidden whitespace-nowrap ${ICON_GAP.row}`}
          >
            <span className="shrink-0 text-gray-400 dark:text-gray-500">
              <GlyphIcon d={channelGlyph(detail.channelId)} size={ICON_SIZE.rowLead} />
            </span>
            {label}
            {/* Two paragraphs, not one string per channel kind: what a hop is has to be
                readable here as well as from a relay chip's tooltip, and only the first half
                differs between the all-hands channel and an invited one. */}
            <InfoPopover label={label}>
              <span className="block">
                {allHands ? S.company.channels.allHandsInfo : S.company.channels.channelInfo}
              </span>
              <span className="mt-1.5 block">{S.company.channels.hopSummary}</span>
            </InfoPopover>
          </Heading>
          {/* The purpose reads as a subtitle on the same line, so the header stays one row. */}
          {purpose !== null && (
            <span
              data-tooltip={purpose}
              data-tooltip-content="text"
              className="hidden min-w-0 flex-1 truncate text-xs text-gray-500 sm:block dark:text-gray-400"
            >
              {purpose}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <MemberPopover
            members={detail.members}
            onOpenDesk={(principal) => void openDesk(principal)}
            openingDesk={openingDesk}
          />
          {/* Inviting is a member's action, and never edits the all-hands channel — which
              already holds everyone, so its candidate list is empty by construction. Both
              refusals are the server's rule (`all_hands_immutable`, `not_a_member`); the
              button is absent rather than dead. */}
          {!allHands && detail.isMember && !detail.archived && (
            <InvitePicker
              candidates={candidates}
              query={query}
              onQuery={setQuery}
              onPick={(c) => void invite(c)}
              busy={busy}
            />
          )}
          {!allHands && detail.isMember && !detail.archived && (
            <Button size="sm" disabled={busy} onClick={() => setLeaveOpen(true)}>
              <span className={`flex items-center ${ICON_GAP.tight}`}>
                <GlyphIcon d={LEAVE_ICON} size={ICON_SIZE.inlineGlyph} />
                {S.company.channels.leave}
              </span>
            </Button>
          )}
          <Dropdown
            open={menuOpen}
            setOpen={setMenuOpen}
            portal={{ direction: "down", align: "right" }}
            menuClass="w-44"
            className="shrink-0"
            button={
              <button
                type="button"
                data-tooltip={S.company.channels.channelMenu}
                aria-label={`${S.company.channels.channelMenu}: ${label}`}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen(!menuOpen)}
                className="flex h-7 w-7 items-center justify-center rounded text-gray-400 transition-colors duration-150 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-500 dark:hover:bg-gray-800 dark:hover:text-gray-200"
              >
                <GlyphIcon d={ICONS.ellipsis} size={ICON_SIZE.iconButton} filled />
              </button>
            }
          >
            <Menu density="sm">
              {!detail.archived && (
                <>
                  <MenuItem
                    glyph={ICONS.pencil}
                    label={S.company.channels.rename}
                    onSelect={() => {
                      setMenuOpen(false);
                      setRenameOpen(true);
                    }}
                  />
                  <MenuItem
                    glyph={PURPOSE_ICON}
                    label={S.company.channels.editPurpose}
                    onSelect={() => {
                      setMenuOpen(false);
                      setPurposeOpen(true);
                    }}
                  />
                </>
              )}
              {/* Archiving is a people-only action, and the Web App's caller is always a
                  person — an employee reaches channels through the CLI. */}
              {!allHands &&
                (detail.archived ? (
                  <MenuItem
                    glyph={ICONS.archiveRestore}
                    label={S.company.channels.unarchive}
                    onSelect={() => {
                      setMenuOpen(false);
                      void setArchived(false);
                    }}
                  />
                ) : (
                  <MenuItem
                    glyph={ICONS.archive}
                    label={S.company.channels.archive}
                    onSelect={() => {
                      setMenuOpen(false);
                      setArchiveOpen(true);
                    }}
                  />
                ))}
            </Menu>
            {/* The all-hands channel simply has no archive row; one short line says why it is
                missing. What that channel IS belongs to the header's "?", and repeating the
                whole paragraph here made a menu out of an explanation. */}
            {allHands && detail.archived === false && (
              <p className="px-2.5 py-1.5 text-xs text-fg-subtle">
                {S.company.channels.allHandsNoArchive}
              </p>
            )}
          </Dropdown>
        </div>
      </div>

      <ChannelTextDialog
        open={renameOpen}
        title={S.company.channels.renameTitle}
        label={S.company.channels.nameField}
        initial={detail.name}
        required
        onClose={() => setRenameOpen(false)}
        onSubmit={(value) => patchText({ name: value })}
      />
      <ChannelTextDialog
        open={purposeOpen}
        title={S.company.channels.purposeTitle}
        label={S.company.channels.purpose}
        hint={S.company.channels.purposeHint}
        initial={detail.purpose}
        multiline
        onClose={() => setPurposeOpen(false)}
        onSubmit={(value) => patchText({ purpose: value })}
      />
      <ConfirmModal
        open={leaveOpen}
        title={S.company.channels.leaveTitle}
        confirmLabel={S.company.channels.leave}
        cancelLabel={S.common.cancel}
        busy={busy}
        onClose={() => (busy ? undefined : setLeaveOpen(false))}
        onConfirm={() => void leave(me)}
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {S.company.channels.leaveConfirm(label)}
        </p>
      </ConfirmModal>
      <ConfirmModal
        open={archiveOpen}
        title={S.company.channels.archiveTitle}
        confirmLabel={S.company.channels.archive}
        cancelLabel={S.common.cancel}
        busy={busy}
        onClose={() => (busy ? undefined : setArchiveOpen(false))}
        onConfirm={() => void setArchived(true)}
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">
          {S.company.channels.archiveConfirm(label)}
        </p>
      </ConfirmModal>
    </>
  );
}
