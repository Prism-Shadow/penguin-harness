/**
 * A part's own files, read-only: the body of a Skill's, a hook package's or a workbench's row on
 * the Plugins tab opens this dialog, titled with the part, over the part's directory in the Agent
 * State (`partDir`). It reads through the Files panel's directory routes on the server the Agent
 * lives on, and lands on the file that says what the part is (`PART_LEAD`).
 *
 * Preview and Download only. A part changes through a chat or an import: a removed SKILL.md or
 * hooks.json breaks the part, and an edit to a workbench reloads it and records a version.
 */
import type { ReactNode } from "react";
import type { WorkspaceFileEntry } from "@prismshadow/penguin-server/api";
import { Modal } from "@prismshadow/penguin-ui";
import { DirBrowser } from "@prismshadow/penguin-web/internal-hub";
import { PART_LEAD, partDir, type PartRef } from "./plugins-subpages";

/** Not listed: dot entries (the server's own `.build`, `.harness`, `.disabled`) and installed dependencies. */
const hidden = (entry: WorkspaceFileEntry): boolean =>
  entry.name.startsWith(".") || entry.name === "node_modules";

export function PartFilesDialog({
  projectId,
  machineId,
  stateDir,
  part,
  actions,
  onClose,
}: {
  projectId: string;
  /** The machine the Agent lives on; null for this server. */
  machineId: string | null;
  /** The Agent State's absolute path on that server, as the Agent's config read answered it. */
  stateDir: string;
  part: PartRef;
  actions?: ReactNode;
  onClose: () => void;
}) {
  return (
    <Modal open title={part.title} onClose={onClose} widthClass="sm:max-w-4xl" footer={actions}>
      <DirBrowser
        scope={{ kind: "workspace", projectId, workspace: partDir(stateDir, part), machineId }}
        headerFallback={part.name}
        lead={PART_LEAD[part.kind]}
        skip={hidden}
        // A SKILL.md's frontmatter is what the row already says (name, description, version):
        // the preview reads its body, as the plugin detail's Files section does.
        stripFrontmatter
      />
    </Modal>
  );
}
