import { S } from "../../lib/strings";

export function SceneReview({ spec }: { spec: Record<string, unknown> | null }) {
  const scenes = spec?.scenes ?? spec?.stages;
  if (!Array.isArray(scenes))
    return <p className="text-sm text-gray-500">{S.activities.noScenes}</p>;
  return (
    <div className="space-y-2">
      {scenes.map((scene, index) => (
        <details
          key={`${scene.id}-${index}`}
          className="rounded-lg border border-gray-200 p-3 dark:border-gray-800"
        >
          <summary className="cursor-pointer break-words text-sm font-medium">
            {index + 1}. {String(scene.id)}
          </summary>
          <p className="mt-3 whitespace-pre-wrap break-words text-sm">
            {String(scene.description)}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {[
              ...(scene.media?.images ?? []),
              ...(scene.media?.video ?? []),
              ...(scene.media?.animations ?? []),
              ...(scene.audio?.tracks ?? []),
            ].map((asset, i) => (
              <span
                key={`${asset.key}-${i}`}
                className="rounded bg-gray-100 px-2 py-1 text-xs dark:bg-gray-800"
              >
                {String(asset.key)}
              </span>
            ))}
          </div>
        </details>
      ))}
    </div>
  );
}
