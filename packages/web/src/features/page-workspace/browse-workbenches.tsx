import { IconButton, GlyphIcon, ICONS } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { usePageWorkspace } from "./context";

export function BrowseWorkbenches({
  agentId,
  machineId,
}: {
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
      onClick={() => workspace.browse(agentId, machineId)}
    >
      <GlyphIcon d={ICONS.tiles} />
    </IconButton>
  );
}
