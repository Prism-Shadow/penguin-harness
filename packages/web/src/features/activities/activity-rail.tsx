/**
 * The workspace's left rail: the parts an activity is made of, with its scenes nested
 * under the media section. It scrolls on its own while the workspace header above it
 * does not. Generation stays in the Description section rather than being repeated
 * here: one action with one name, in one place.
 */
import { Select } from "../../components/ui/select";
import { S } from "../../lib/strings";
import { SceneAssetTree, type SceneAssetSelection } from "./scene-asset-tree";
import type { SceneAssetTree as Tree, SceneAssetType } from "./scene-assets";
import type { WorkspaceSection, WorkspaceSectionEntry } from "./workspace-model";

export function ActivityRail({
  sections,
  section,
  onSection,
  languages,
  tree,
  language,
  onLanguage,
  kind,
  onKind,
  selection,
  onSelect,
}: {
  sections: readonly WorkspaceSectionEntry[];
  section: WorkspaceSection;
  onSection: (section: WorkspaceSection) => void;
  /** The language groups a media plan offers; empty until one exists. */
  languages: readonly string[];
  /** The scene tree for the chosen language and filter, built once by the page. */
  tree: Tree;
  language: string;
  onLanguage: (language: string) => void;
  kind: SceneAssetType | "all";
  onKind: (kind: SceneAssetType | "all") => void;
  selection: SceneAssetSelection | null;
  onSelect: (selection: SceneAssetSelection) => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <nav
        aria-label={S.activities.workspaceSections}
        className="min-h-0 flex-1 overflow-y-auto p-2"
      >
        {sections.map((entry) => (
          <div key={entry.key}>
            <button
              type="button"
              aria-current={entry.key === section ? "true" : undefined}
              disabled={!entry.enabled}
              onClick={() => onSection(entry.key)}
              className={`block w-full rounded-md px-2 py-1.5 text-left text-xs disabled:cursor-not-allowed disabled:opacity-50 ${
                entry.key === section
                  ? "bg-gray-100 font-medium dark:bg-gray-800"
                  : "hover:bg-gray-50 dark:hover:bg-gray-900"
              }`}
            >
              {S.activities.sectionNames[entry.key]}
            </button>
            {entry.key === "scenes" && entry.enabled && section === "scenes" && (
              <div className="mt-1 mb-2 ml-2 border-l border-gray-200 pl-2 dark:border-gray-800">
                <div className="mb-1 grid gap-1">
                  <Select
                    size="sm"
                    label={S.activities.mediaLanguage}
                    value={language}
                    onChange={(event) => onLanguage(event.target.value)}
                  >
                    {languages.map((code) => (
                      <option key={code} value={code}>
                        {code}
                      </option>
                    ))}
                  </Select>
                  <Select
                    size="sm"
                    label={S.activities.mediaType}
                    value={kind}
                    onChange={(event) => onKind(event.target.value as SceneAssetType | "all")}
                  >
                    {(["all", "audio", "image", "video", "animation"] as const).map((type) => (
                      <option key={type} value={type}>
                        {S.activities.mediaTypes[type]}
                      </option>
                    ))}
                  </Select>
                </div>
                <SceneAssetTree tree={tree} selection={selection} onSelect={onSelect} />
              </div>
            )}
          </div>
        ))}
      </nav>
    </div>
  );
}
