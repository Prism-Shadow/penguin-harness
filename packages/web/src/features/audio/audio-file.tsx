/**
 * The `audio` file renderer: a linked audio file as the browser's own player, below the reply
 * paragraph that links it. `preload="none"` — a transcript can link many files, and nothing is
 * fetched until the reader presses play. The file comes through the Workspace file URL, which
 * answers the whole file (no Range requests): it plays, and seeks within what has loaded.
 *
 * A file that cannot be played — gone since the reply was written, or in a format this browser
 * does not decode — turns the player into a line saying so once playback has been tried; the
 * link above it still opens the file in the Files panel.
 */
import { useState } from "react";
import type { FileRendererProps } from "../../lib/file-renderers";
import { S } from "../../lib/strings";
import { toneInk } from "../../lib/tone";

export function AudioFile({ url, name }: FileRendererProps) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <p role="status" className={`m-0 text-sm ${toneInk.danger}`}>
        {S.files.audioUnavailable(name)}
      </p>
    );
  }
  return (
    <audio
      controls
      preload="none"
      src={url}
      aria-label={S.files.audioLabel(name)}
      onError={() => setFailed(true)}
      className="block h-10 w-full max-w-md"
    />
  );
}
