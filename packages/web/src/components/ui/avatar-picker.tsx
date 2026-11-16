/**
 * The two controls every avatar's settings have, in the order a person's profile row set them:
 * Change avatar — a picked file is decoded, its square chosen in the crop dialog, and the crop
 * encoded and stored on confirm — then Restore default, which removes the picture once it is
 * confirmed: it deletes the uploaded picture, and only a fresh upload brings it back. One picker for
 * a person's own avatar, an employee's and an Agent's own, since all three are stored by the same
 * rule (lib/avatar-image.ts encodes for it). The caller draws the preview beside it.
 *
 * The picker owns the choice, not the write. The caller hands it `save` and runs every write
 * through its own `run`, so the busy window and the failure's words are the page's: a write here
 * and one beside it (a nickname, an employee's name) are never in flight together. The encode
 * runs inside that window as well as the request — it redraws the image, which for a phone
 * photograph is long enough to click twice through — and the crop dialog stays open, held still,
 * until the write answers. Nothing is applied optimistically: the preview shows what is stored.
 */
import { useState, type ChangeEvent } from "react";

import { Button, ConfirmModal, HiddenFileInput, buttonClass } from "@prismshadow/penguin-ui";
import {
  avatarDataUrlFromImage,
  loadAvatarImage,
  releaseAvatarImage,
  type AvatarCrop,
} from "../../lib/avatar-image";
import { S } from "../../lib/strings";
import { AvatarCropDialog } from "./avatar-crop-dialog";

/** What the picker offers — the three formats the server stores, spelled the way `accept` wants. */
const AVATAR_ACCEPT = "image/png,image/jpeg,image/webp";

const CHANGE_CLASS = buttonClass("secondary", "sm");

/**
 * A label has no disabled state: ignore pointer input while a write runs, including hover
 * styling. The input inside is disabled too, so Tab skips it.
 */
const CHANGE_BUSY_CLASS = `${CHANGE_CLASS} pointer-events-none opacity-60`;

export interface AvatarPickerProps {
  /** A picture is stored: Restore default is live only then. */
  hasPicture: boolean;
  /** A write is in flight — this picker's or one beside it: the controls and the crop dialog hold still. */
  busy: boolean;
  /** Runs one write inside the caller's busy window; resolves once it is over, however it ended. */
  run: (work: () => Promise<void>) => Promise<void>;
  /** Stores the picture (a data URL), or removes it with `null`. */
  save: (avatar: string | null) => Promise<void>;
  /**
   * Why a picked file cannot become an avatar — it would not decode, or would not fit the cap —
   * and `null` as a new file is picked, clearing what was said before.
   */
  onError: (message: string | null) => void;
}

export function AvatarPicker({ hasPicture, busy, run, save, onError }: AvatarPickerProps) {
  /** The picked image, decoded and waiting for its crop to be chosen. */
  const [cropping, setCropping] = useState<HTMLImageElement | null>(null);
  const [confirming, setConfirming] = useState(false);

  const endCrop = (): void => {
    if (cropping !== null) releaseAvatarImage(cropping);
    setCropping(null);
  };

  const onPickFile = (e: ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0];
    // Reset before reading so re-picking the same file fires change again.
    e.target.value = "";
    if (file === undefined) return;
    onError(null);
    loadAvatarImage(file).then(setCropping, () => onError(S.profile.avatarUnreadable));
  };

  const onCropped = (crop: AvatarCrop): void => {
    const image = cropping;
    if (image === null) return;
    void run(async () => {
      const dataUrl = avatarDataUrlFromImage(image, crop);
      if (dataUrl === null) {
        onError(S.profile.avatarTooLarge);
        return;
      }
      await save(dataUrl);
    }).finally(endCrop);
  };

  const restore = (): void => void run(() => save(null));
  const restoreLabel = S.profile.restoreDefaultOf(S.profile.avatar);

  return (
    <>
      {/* A label rather than a Button: the hidden file input has to be labelled for a click to
          open the native picker. Same two records Button reads, at the form rung its neighbours
          sit on. */}
      <label className={`shrink-0 ${busy ? CHANGE_BUSY_CLASS : CHANGE_CLASS}`}>
        <HiddenFileInput accept={AVATAR_ACCEPT} disabled={busy} onChange={onPickFile} />
        {S.profile.changeAvatar}
      </label>
      <Button
        size="sm"
        variant="secondary"
        className="shrink-0"
        aria-label={restoreLabel}
        disabled={busy || !hasPicture}
        onClick={() => setConfirming(true)}
      >
        {S.profile.restoreDefault}
      </Button>
      <AvatarCropDialog image={cropping} busy={busy} onCancel={endCrop} onConfirm={onCropped} />
      <ConfirmModal
        open={confirming}
        title={restoreLabel}
        onClose={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          restore();
        }}
        confirmLabel={S.profile.restoreDefault}
        cancelLabel={S.common.cancel}
      >
        <p className="text-sm text-gray-600 dark:text-gray-300">{S.profile.avatarResetConfirm}</p>
      </ConfirmModal>
    </>
  );
}
