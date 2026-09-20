import { useState } from "react";
import { Button } from "../../components/ui/button";
import { S } from "../../lib/strings";
import { toneInk } from "../../lib/tone";

/** Mounted with a binding/revision/checkout key so an old image cannot survive a new selection. */
export function ImagePreview({ src, description }: { src: string; description: string }) {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const [dimensions, setDimensions] = useState("");
  const url = `${src}${src.includes("?") ? "&" : "?"}attempt=${attempt}`;
  function load() {
    setFailed(false);
    setDimensions("");
    setAttempt((value) => value + 1);
  }
  return (
    <div className="space-y-2">
      {!attempt || failed ? (
        <>
          {failed && (
            <p role="status" className={`text-xs ${toneInk.attention}`}>
              {S.activities.imageUnavailable}
            </p>
          )}
          <Button size="sm" onClick={load}>
            {failed ? S.common.retry : S.activities.previewImage}
          </Button>
        </>
      ) : (
        <>
          {!dimensions && (
            <p role="status" className="text-xs text-gray-500">
              {S.activities.loadingImage}
            </p>
          )}
          <img
            key={url}
            src={url}
            alt={description}
            className="max-h-96 max-w-full rounded border border-gray-200 bg-gray-50 object-contain dark:border-gray-800 dark:bg-gray-900"
            onLoad={(event) =>
              setDimensions(
                `${event.currentTarget.naturalWidth} × ${event.currentTarget.naturalHeight}`,
              )
            }
            onError={() => setFailed(true)}
          />
          {dimensions && (
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <span className="text-gray-500">{S.activities.imageDimensions(dimensions)}</span>
              <a className="underline" href={url} target="_blank" rel="noopener noreferrer">
                {S.activities.fullImage}
              </a>
              <Button size="sm" onClick={load}>
                {S.activities.reloadImage}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
