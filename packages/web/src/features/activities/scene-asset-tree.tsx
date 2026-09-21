/**
 * The scene tree behind the media workbench: every scene the saved specification
 * declares, the media each one asks for, and whether that media is bound yet.
 * Selection is a scene plus an asset key, because one asset can serve many scenes
 * and an author reaches it through the scene they are working on.
 */
import { useState } from "react";
import { Chevron } from "../../components/ui/chevron";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { ICON_GAP, ICON_SIZE } from "../../lib/icon-scale";
import { S } from "../../lib/strings";
import { toneDot, toneInk } from "../../lib/tone";
import { SCENE_ASSET_ICON } from "./scene-asset-icons";
import type { SceneAssetLeaf, SceneAssetTree as Tree } from "./scene-assets";

export interface SceneAssetSelection {
  sceneId: string;
  key: string;
}

export function sameSelection(left: SceneAssetSelection, right: SceneAssetSelection): boolean {
  return left.sceneId === right.sceneId && left.key === right.key;
}

/** The first leaf the tree draws, so a fresh tree opens on something. */
export function firstSelection(tree: Tree): SceneAssetSelection | null {
  for (const scene of tree.scenes)
    for (const category of scene.categories)
      if (category.assets[0]) return { sceneId: scene.sceneId, key: category.assets[0].key };
  const orphan = tree.unassigned[0];
  return orphan ? { sceneId: "", key: orphan.key } : null;
}

function AssetRow({
  asset,
  sceneId,
  selected,
  onSelect,
}: {
  asset: SceneAssetLeaf;
  sceneId: string;
  selected: boolean;
  onSelect: (selection: SceneAssetSelection) => void;
}) {
  const state = asset.bound ? S.activities.boundMedia : S.activities.unboundMedia;
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => onSelect({ sceneId, key: asset.key })}
      className={`flex w-full items-start rounded-md px-2 py-1.5 text-left text-xs ${ICON_GAP.row} ${
        selected
          ? "bg-gray-100 font-medium dark:bg-gray-800"
          : "hover:bg-gray-50 dark:hover:bg-gray-900"
      }`}
    >
      <GlyphIcon
        d={SCENE_ASSET_ICON[asset.type]}
        size={ICON_SIZE.rowLead}
        className="mt-0.5 text-gray-500"
      />
      <span className="min-w-0 flex-1">
        <span className="block break-all">{asset.key}</span>
        <span className="block text-gray-500">
          {state}
          {asset.shared ? ` · ${S.activities.sharedAsset}` : ""}
          {asset.occurrences > 1 ? ` · ${S.activities.sceneOccurrences(asset.occurrences)}` : ""}
        </span>
      </span>
      <span
        aria-hidden
        className={`mt-1.5 size-1.5 shrink-0 rounded-full ${asset.bound ? toneDot.success : toneDot.attention}`}
      />
    </button>
  );
}

export function SceneAssetTree({
  tree,
  selection,
  onSelect,
}: {
  tree: Tree;
  selection: SceneAssetSelection | null;
  onSelect: (selection: SceneAssetSelection) => void;
}) {
  // Scenes start closed so a long activity stays readable; the scene holding the
  // current selection is always drawn open, which is what makes a fresh tree useful.
  const [opened, setOpened] = useState<string[]>([]);
  function toggle(sceneId: string) {
    setOpened((current) =>
      current.includes(sceneId)
        ? current.filter((entry) => entry !== sceneId)
        : [...current, sceneId],
    );
  }
  if (!tree.scenes.length && !tree.unassigned.length)
    return <p className="text-sm text-gray-500">{S.activities.noMediaAssets}</p>;
  return (
    <div aria-label={S.activities.sceneAssetTree} className="flex flex-col gap-1">
      {tree.scenes.map((scene) => {
        const holdsSelection = selection?.sceneId === scene.sceneId;
        const open = opened.includes(scene.sceneId) || holdsSelection;
        const panelId = `scene-assets-${scene.sceneId}`;
        const bound = scene.categories
          .flatMap((category) => category.assets)
          .filter((asset) => asset.bound).length;
        const total = scene.categories.flatMap((category) => category.assets).length;
        return (
          <div key={scene.sceneId}>
            <button
              type="button"
              aria-expanded={open}
              aria-controls={panelId}
              onClick={() => toggle(scene.sceneId)}
              className={`flex w-full items-center rounded-md px-1.5 py-1.5 text-left text-xs font-medium hover:bg-gray-50 dark:hover:bg-gray-900 ${ICON_GAP.row}`}
            >
              <Chevron open={open} size={ICON_SIZE.chevronDense} className="text-gray-500" />
              <span className="min-w-0 flex-1 break-all">{scene.sceneId}</span>
              <span className="shrink-0 font-normal text-gray-500">
                {S.activities.sceneBoundCount(bound, total)}
              </span>
            </button>
            <div id={panelId} hidden={!open} className="pl-3">
              {scene.description && (
                <p className="px-2 pb-1 text-xs whitespace-pre-wrap text-gray-500">
                  {scene.description}
                </p>
              )}
              {scene.categories.map((category) => (
                <div key={category.type} className="pb-1">
                  <p className="px-2 py-1 text-xs text-gray-500">
                    {S.activities.mediaCategories[category.type]}
                  </p>
                  {category.assets.map((asset) => (
                    <AssetRow
                      key={asset.key}
                      asset={asset}
                      sceneId={scene.sceneId}
                      selected={
                        !!selection &&
                        sameSelection(selection, {
                          sceneId: scene.sceneId,
                          key: asset.key,
                        })
                      }
                      onSelect={onSelect}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        );
      })}
      {tree.unassigned.length > 0 && (
        <div className="pt-1">
          <p className={`px-1.5 py-1 text-xs font-medium ${toneInk.attention}`}>
            {S.activities.unassignedScene}
          </p>
          <p className="px-1.5 pb-1 text-xs text-gray-500">{S.activities.unassignedSceneHint}</p>
          <div className="pl-3">
            {tree.unassigned.map((asset) => (
              <AssetRow
                key={asset.key}
                asset={asset}
                sceneId=""
                selected={!!selection && sameSelection(selection, { sceneId: "", key: asset.key })}
                onSelect={onSelect}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
