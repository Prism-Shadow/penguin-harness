import { useNavigate } from "react-router";
import { Button, DefaultModelSections, Notice, Spinner, useSaving } from "@prismshadow/penguin-ui";
import {
  MULTIMODAL_TOOLS_PACKAGE,
  sameModelRef,
  S,
  modelLabel,
  useDefaultModelRows,
} from "@prismshadow/penguin-web/internal";
import { DictationPolishSettings } from "./dictation-polish-settings";
import { PROJECT_SETTINGS_SCOPE } from "./shared";

/**
 * The Project's multimodal models: the rows of the Models page's Default models dialog without
 * its chat group — the multimodal defaults, then the quieter tool defaults — built by the same hook
 * and laid out by the same component, so the page and the dialog list the same rows in the same
 * order with the same candidates and empty states. The pane heading names the page, so the
 * multimodal rows carry no eyebrow of their own. Dictation's polish follows, when the multimodal
 * tools plugin declares speech recognition. What the page is for is the pane heading's "?".
 */
export function MultimodalModelsSection({
  projectId,
  owner,
}: {
  projectId: string;
  owner: boolean;
}) {
  const navigate = useNavigate();
  const { table, bindings, sections, tableError, toolsError, saving, reload } = useDefaultModelRows(
    {
      projectId,
      userId: null,
      owner,
      active: true,
      // Leaving for the Models page closes Project settings: the dialog lives in the search.
      onOpenModels: () => void navigate("/models"),
    },
  );
  useSaving(saving, PROJECT_SETTINGS_SCOPE);

  const error = toolsError || tableError;
  const loadError = error && (
    <Notice tone="attention">
      {error}
      <Button size="xs" onClick={reload}>
        {S.common.retry}
      </Button>
    </Notice>
  );
  if (!table || !bindings || !sections) return loadError || <Spinner label={S.common.loading} />;

  const dictation = bindings.some((b) => b.key === "s2t" && b.package === MULTIMODAL_TOOLS_PACKAGE);
  return (
    <div className="space-y-6">
      {loadError}
      <DefaultModelSections
        sections={[
          { key: sections.multimodal.key, rows: sections.multimodal.rows },
          sections.tools,
        ]}
      />
      {dictation && (
        <DictationPolishSettings
          projectId={projectId}
          owner={owner}
          refreshKey={bindings}
          labelOf={(ref) => {
            const row = table.models.find((m) => sameModelRef(m, ref));
            return row ? modelLabel(row) : ref.modelId;
          }}
        />
      )}
    </div>
  );
}
