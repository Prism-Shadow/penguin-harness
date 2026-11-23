import { IconButton, GlyphIcon, ICONS } from "@prismshadow/penguin-ui";
import { S } from "../../../lib/strings";
import { usePageWorkspace } from "../../../lib/page-workspace";

export function BrowseWorkbenches({
  sessionId,
  agentId,
  machineId,
}: {
  sessionId: string;
  agentId: string;
  machineId: string | null;
}) {
  const workspace = usePageWorkspace();
  if (!workspace) return null;
  return (
    <IconButton
      label={S.pageWorkspace.browse}
      variant="ghost"
      size="sm"
      onClick={() => workspace.browse(sessionId, agentId, machineId)}
    >
      <GlyphIcon d={ICONS.tiles} />
    </IconButton>
  );
}
