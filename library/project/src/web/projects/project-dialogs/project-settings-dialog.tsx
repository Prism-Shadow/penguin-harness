import { useState } from "react";
import { ICONS, PagedDialog, guardLeave, useGuardedClose } from "@prismshadow/penguin-ui";
import { S } from "@prismshadow/penguin-web/internal";
import { useProject } from "@prismshadow/penguin-web/internal";
import { useAuth } from "@prismshadow/penguin-web/internal";
import { PROJECT_SETTINGS_SCOPE } from "./shared";
import { GeneralSection } from "./general-section";
import { MembersSection } from "./members-section";
import { ChatDefaultsSection } from "./chat-defaults-section";
import { MultimodalModelsSection } from "./multimodal-models-section";
import { SecurityPolicySection } from "./security-policy-section";

export const TAB_ICON_PATHS = {
  general: ICONS.gear,
  /** Two people: Project members are humans, so the Agent glyph does not stand in here. */
  members: ICONS.users,
  /** Three sliders set at different heights. */
  defaults: ICONS.sliders,
  /** The shield with a check: the policy that guards the Project. */
  security: ICONS.shieldCheck,
  multimodal: ICONS.chip,
} as const;

export type SettingsTab = keyof typeof TAB_ICON_PATHS;

interface ProjectSettingsProps {
  onClose: () => void;
  initialTab?: SettingsTab;
  onSelectTab?: (tab: SettingsTab) => void;
}

export function ProjectSettingsDialog({
  open,
  ...props
}: ProjectSettingsProps & { open: boolean }) {
  return open ? <ProjectSettingsBody {...props} /> : null;
}

export function ProjectSettingsBody({
  onClose,
  initialTab = "general",
  onSelectTab,
}: ProjectSettingsProps) {
  const { desktopMode } = useAuth();
  const { currentProject } = useProject();
  const [localTab, setLocalTab] = useState<SettingsTab>(initialTab);
  const tab = onSelectTab ? initialTab : localTab;
  const requestClose = useGuardedClose(onClose, PROJECT_SETTINGS_SCOPE);

  const projectId = currentProject?.projectId;
  const isOwner = currentProject?.role === "owner";
  if (!currentProject || !projectId) return null;

  // `info` is the page's semantic explanation, disclosed by a "?" beside the pane heading —
  // the only title these pages have, since each section renders its rows without repeating it.
  const tabs: { key: SettingsTab; label: string; info?: string }[] = [
    { key: "general", label: S.project.settingsTabGeneral },
    ...(!desktopMode ? [{ key: "members" as const, label: S.project.settingsTabMembers }] : []),
    { key: "defaults", label: S.project.settingsTabDefaults },
    { key: "multimodal", label: S.voice.models, info: S.voice.modelHelp },
    {
      key: "security",
      label: S.project.settingsTabSecurity,
      info: S.project.commandPolicyInfo,
    },
  ];
  const active = tabs.find((t) => t.key === tab) ?? tabs[0]!;

  // The Settings dialog's shell: the rail stays put beside the pane, and only the pane scrolls.
  return (
    <PagedDialog
      open
      onClose={requestClose}
      title={S.project.settingsTitle}
      groups={[
        {
          key: "project",
          items: tabs.map((t) => ({
            key: t.key,
            label: t.label,
            icon: TAB_ICON_PATHS[t.key],
            ...(t.info !== undefined ? { info: t.info } : {}),
          })),
        },
      ]}
      active={active.key}
      onSelect={(key) => {
        if (key !== active.key)
          void guardLeave(() => (onSelectTab ?? setLocalTab)(key), PROJECT_SETTINGS_SCOPE);
      }}
    >
      {active.key === "general" && (
        <GeneralSection projectId={projectId} isOwner={isOwner} onClose={onClose} />
      )}
      {active.key === "members" && <MembersSection projectId={projectId} isOwner={isOwner} />}
      {active.key === "defaults" && <ChatDefaultsSection projectId={projectId} isOwner={isOwner} />}
      {active.key === "multimodal" && (
        <MultimodalModelsSection projectId={projectId} owner={isOwner} />
      )}
      {active.key === "security" && (
        <SecurityPolicySection projectId={projectId} isOwner={isOwner} />
      )}
    </PagedDialog>
  );
}
