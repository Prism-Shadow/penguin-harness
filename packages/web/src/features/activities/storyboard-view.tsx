/**
 * The Scenes section's first view: the storyboard. Each scene is a frame in the
 * specification's order, showing its first bound image, and marked when an agent is
 * working on it, when a proposal waits for it, or when it still lacks media. Choosing a
 * frame makes it the scene the conversation is about; opening it opens its media.
 */
import { useState } from "react";
import type { SceneAssetLeaf } from "./scene-assets";
import { Button } from "../../components/ui/button";
import { S } from "../../lib/strings";
import { toneDot } from "../../lib/tone";
import type { StoryboardFrame } from "./storyboard";

function Thumbnail({ src, alt, fallback }: { src: string | null; alt: string; fallback: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed)
    return (
      <span className="line-clamp-4 p-2 text-left text-xs text-gray-400 dark:text-gray-500">
        {fallback}
      </span>
    );
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      className="size-full object-cover"
      onError={() => setFailed(true)}
    />
  );
}

export function Storyboard({
  frames,
  selected,
  assetsOf,
  thumbnailUrl,
  onSelect,
  onOpen,
  onPlay,
  onEditMedia,
  onAssemble,
}: {
  frames: readonly StoryboardFrame[];
  selected: string | null;
  /** The chosen scene's media, for the sheet above the frames. */
  assetsOf: (sceneId: string) => SceneAssetLeaf[];
  thumbnailUrl: (assetKey: string) => string;
  onSelect: (sceneId: string) => void;
  onOpen: (sceneId: string, assetKey: string) => void;
  onPlay: () => void;
  /** Leave the board for the per-asset editor, on the chosen scene when there is one. */
  onEditMedia: () => void;
  /** Open the Build stage, where assembling is checked and started. */
  onAssemble: () => void;
}) {
  const words = S.activities.studioBoard;
  const current = frames.find((frame) => frame.sceneId === selected) ?? null;
  const label = (frame: StoryboardFrame) =>
    frame.general ? words.shared : words.scene(frame.number, frame.sceneId);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 px-4 py-2 dark:border-gray-800">
        <h2 className="text-sm font-semibold">{words.title}</h2>
        <span className="text-xs text-gray-500">{words.count(frames.length)}</span>
        <span className="flex-1" />
        <Button size="sm" variant="ghost" onClick={onEditMedia}>
          {words.editMedia}
        </Button>
        <Button size="sm" variant="ghost" onClick={onPlay}>
          {words.play}
        </Button>
        <Button size="sm" onClick={onAssemble}>
          {words.assemble}
        </Button>
      </div>
      {current && (
        <div className="space-y-1.5 border-b border-gray-200 px-4 py-2.5 dark:border-gray-800">
          <div className="flex items-baseline gap-2">
            <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">{label(current)}</h3>
            {current.firstAssetKey && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onOpen(current.sceneId, current.firstAssetKey!)}
              >
                {words.open}
              </Button>
            )}
          </div>
          {current.description && (
            <p className="line-clamp-2 text-xs text-gray-600 dark:text-gray-400">
              {current.description}
            </p>
          )}
          <div className="flex flex-wrap gap-1">
            {assetsOf(current.sceneId).length === 0 ? (
              <span className="text-xs text-gray-500">{words.noAssets}</span>
            ) : (
              assetsOf(current.sceneId).map((asset) => (
                <button
                  key={asset.key}
                  type="button"
                  onClick={() => onOpen(current.sceneId, asset.key)}
                  className="flex items-center gap-1.5 rounded px-1.5 py-0.5 text-xs text-brand-700 hover:bg-brand-50 dark:text-brand-300 dark:hover:bg-brand-950"
                >
                  {asset.key}
                  {!asset.bound && (
                    <span
                      role="img"
                      aria-label={words.unbound(1)}
                      className={`size-1.5 rounded-full ${toneDot.attention}`}
                    />
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {frames.length === 0 ? (
          <p className="text-sm text-gray-500">{words.empty}</p>
        ) : (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))] gap-4">
            {frames.map((frame) => {
              const chosen = frame.sceneId === selected;
              const states = [
                frame.working && words.working,
                frame.proposed && words.proposed,
                frame.unbound > 0 && words.unbound(frame.unbound),
              ].filter(Boolean);
              return (
                <li key={frame.sceneId}>
                  <button
                    type="button"
                    aria-pressed={chosen}
                    aria-label={[label(frame), ...states].join(". ")}
                    onClick={() => onSelect(frame.sceneId)}
                    onDoubleClick={() =>
                      frame.firstAssetKey && onOpen(frame.sceneId, frame.firstAssetKey)
                    }
                    className="group block w-full text-left"
                  >
                    <span
                      // A waiting proposal is drawn as a ghost: the frame's outline dashed,
                      // with the attention dot in its caption carrying the state.
                      className={`flex aspect-[4/3] items-start overflow-hidden rounded-md border bg-gray-50 dark:bg-gray-900 ${
                        frame.proposed ? "border-dashed" : ""
                      } ${
                        chosen
                          ? "border-brand-600 ring-2 ring-brand-600/25"
                          : frame.proposed
                            ? "border-gray-400 dark:border-gray-500"
                            : "border-gray-200 group-hover:border-gray-400 dark:border-gray-800 dark:group-hover:border-gray-600"
                      }`}
                    >
                      <Thumbnail
                        src={frame.thumbnailKey ? thumbnailUrl(frame.thumbnailKey) : null}
                        alt=""
                        fallback={frame.description}
                      />
                    </span>
                    <span className="mt-1.5 flex items-center gap-1.5 text-xs">
                      <span className="text-gray-400 tabular-nums">{frame.number}</span>
                      <span
                        className={`min-w-0 flex-1 truncate ${chosen ? "font-semibold text-brand-700 dark:text-brand-300" : "text-gray-700 dark:text-gray-300"}`}
                      >
                        {frame.general ? words.shared : frame.sceneId}
                      </span>
                      {frame.proposed && (
                        <span
                          aria-hidden
                          className={`size-1.5 rounded-full ${toneDot.attention}`}
                        />
                      )}
                      {frame.working && (
                        <span
                          aria-hidden
                          className={`size-1.5 animate-pulse rounded-full ${toneDot.busy}`}
                        />
                      )}
                      {frame.unbound > 0 && (
                        <span
                          aria-hidden
                          className={`size-1.5 rounded-full ${toneDot.attention}`}
                        />
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
