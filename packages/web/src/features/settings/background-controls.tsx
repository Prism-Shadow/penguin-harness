/** A file choice reveals the wallpaper controls; each gesture applies immediately. */
import { useRef, useState } from "react";
import { Button, Fold, PrefRow, Select } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import {
  BACKGROUND_FILE_TYPES,
  BACKGROUND_MAX_BYTES,
  backgroundImageFromFile,
} from "../../lib/background-image";
import {
  BACKGROUND_MODES,
  BACKGROUND_POSITIONS,
  backgroundStyle,
  useBackground,
} from "../../state/background";

export function BackgroundControls() {
  const { image, settings, setImage, setSettings } = useBackground();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const words = S.settings.background;

  function commit(write: () => void) {
    try {
      write();
      setError(null);
    } catch {
      setError(S.settings.background.storageError);
    }
  }

  async function choose(file: File) {
    if (!BACKGROUND_FILE_TYPES.includes(file.type) || file.size > BACKGROUND_MAX_BYTES) {
      setError(S.settings.background.fileError);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const next = await backgroundImageFromFile(file);
      commit(() => setImage(next));
    } catch {
      setError(S.settings.background.readError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PrefRow label={words.title} info={words.info}>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <input
            ref={input}
            type="file"
            accept={BACKGROUND_FILE_TYPES.join(",")}
            className="hidden"
            aria-label={words.choose}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void choose(file);
            }}
          />
          <Button size="sm" disabled={busy} onClick={() => input.current?.click()}>
            {busy ? words.loading : image === null ? words.choose : words.replace}
          </Button>
          {image !== null && (
            <Button size="sm" disabled={busy} onClick={() => commit(() => setImage(null))}>
              {words.remove}
            </Button>
          )}
        </div>
      </PrefRow>
      {error !== null && (
        <p role="alert" className="pb-3 text-xs text-fg-muted">
          {error}
        </p>
      )}
      <Fold open={image !== null} className="background-settings-details">
        <div
          role="img"
          aria-label={words.preview}
          className="relative h-24 overflow-hidden border-b border-line-muted bg-canvas"
        >
          <div className="absolute inset-0" style={backgroundStyle(image, settings)} />
        </div>
        <PrefRow label={words.transparency}>
          <div className="flex min-w-0 items-center gap-3">
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={settings.transparency}
              aria-label={words.transparency}
              aria-valuetext={`${settings.transparency}%`}
              disabled={busy}
              className="w-32 min-w-0 accent-accent"
              onChange={(event) =>
                commit(() => setSettings({ ...settings, transparency: Number(event.target.value) }))
              }
            />
            <span className="w-10 shrink-0 text-right text-xs tabular-nums text-fg-muted">
              {settings.transparency}%
            </span>
          </div>
        </PrefRow>
        <PrefRow label={words.mode}>
          <span className="w-36 min-w-0">
            <Select
              aria-label={words.mode}
              value={settings.mode}
              disabled={busy}
              onChange={(event) => {
                const mode = BACKGROUND_MODES.find((value) => value === event.target.value);
                if (mode) commit(() => setSettings({ ...settings, mode }));
              }}
            >
              {BACKGROUND_MODES.map((value) => (
                <option key={value} value={value}>
                  {words.modes[value]}
                </option>
              ))}
            </Select>
          </span>
        </PrefRow>
        <PrefRow label={words.position}>
          <span className="w-36 min-w-0">
            <Select
              aria-label={words.position}
              value={settings.position}
              disabled={busy}
              onChange={(event) => {
                const position = BACKGROUND_POSITIONS.find((value) => value === event.target.value);
                if (position) commit(() => setSettings({ ...settings, position }));
              }}
            >
              {BACKGROUND_POSITIONS.map((value) => (
                <option key={value} value={value}>
                  {words.positions[value]}
                </option>
              ))}
            </Select>
          </span>
        </PrefRow>
      </Fold>
    </>
  );
}
