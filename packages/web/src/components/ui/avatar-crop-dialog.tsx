/**
 * Choosing the square of a picked image that becomes an avatar.
 *
 * The frame stays still and the image moves under it: drag to place it, and the wheel or the
 * slider to zoom — the gestures a photo cropper has everywhere. What the frame shows is
 * exactly what is stored (lib/avatar-image.ts draws that same rectangle), so there is no
 * preview beside it to disagree with.
 *
 * One dialog for every avatar the product has — a person's own and an employee's — since both
 * are stored by the same rule. It owns nothing but the choice: the caller decodes the file,
 * and gets the crop back to encode and send.
 */
import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from "react";
import { AVATAR_MAX_ZOOM, clampCrop, initialCrop } from "../../lib/avatar-image";
import type { AvatarCrop } from "../../lib/avatar-image";
import { S } from "../../lib/strings";
import { Button } from "./button";
import { Modal } from "./modal";

/** Edge of the frame on screen, in CSS pixels. */
const FRAME = 256;

export function AvatarCropDialog({
  image,
  busy = false,
  onCancel,
  onConfirm,
}: {
  /** The decoded image to crop; null closes the dialog. */
  image: HTMLImageElement | null;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (crop: AvatarCrop) => void;
}) {
  const width = image?.naturalWidth ?? 1;
  const height = image?.naturalHeight ?? 1;
  const [crop, setCrop] = useState<AvatarCrop>(() => initialCrop(width, height));
  const drag = useRef<{ x: number; y: number; crop: AvatarCrop } | null>(null);

  useEffect(() => {
    if (image !== null) setCrop(initialCrop(image.naturalWidth, image.naturalHeight));
  }, [image]);

  /** Screen pixels per image pixel at the current zoom. */
  const scale = FRAME / (Math.min(width, height) / crop.zoom);
  const move = (next: AvatarCrop) => setCrop(clampCrop(width, height, next));

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (busy) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, crop };
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const from = drag.current;
    if (from === null) return;
    // The image follows the pointer, so the crop's centre goes the other way.
    move({
      zoom: from.crop.zoom,
      cx: from.crop.cx - (e.clientX - from.x) / scale,
      cy: from.crop.cy - (e.clientY - from.y) / scale,
    });
  };
  const endDrag = () => {
    drag.current = null;
  };
  const onWheel = (e: ReactWheelEvent<HTMLDivElement>) => {
    if (busy) return;
    move({ ...crop, zoom: crop.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1) });
  };

  return (
    <Modal
      open={image !== null}
      title={S.profile.cropAvatar}
      onClose={() => (busy ? undefined : onCancel())}
      widthClass="max-w-sm"
      footer={
        <>
          <Button size="sm" onClick={onCancel} disabled={busy}>
            {S.common.cancel}
          </Button>
          <Button size="sm" variant="primary" disabled={busy} onClick={() => onConfirm(crop)}>
            {S.profile.useAvatar}
          </Button>
        </>
      }
    >
      <div className="flex flex-col items-center gap-3">
        <div
          role="img"
          aria-label={S.profile.cropAvatarHint}
          className="relative touch-none select-none overflow-hidden rounded-xl bg-gray-100 dark:bg-gray-800"
          style={{ width: FRAME, height: FRAME, cursor: busy ? "default" : "grab" }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onWheel={onWheel}
        >
          {image !== null && (
            <img
              src={image.src}
              alt=""
              draggable={false}
              className="pointer-events-none absolute max-w-none"
              style={{
                width: width * scale,
                height: height * scale,
                left: FRAME / 2 - crop.cx * scale,
                top: FRAME / 2 - crop.cy * scale,
              }}
            />
          )}
        </div>
        <input
          type="range"
          aria-label={S.profile.cropZoom}
          className="w-full"
          min={1}
          max={AVATAR_MAX_ZOOM}
          step={0.01}
          value={crop.zoom}
          disabled={busy}
          onChange={(e) => move({ ...crop, zoom: Number(e.target.value) })}
        />
        <p className="text-xs text-gray-500 dark:text-gray-400">{S.profile.cropAvatarHint}</p>
      </div>
    </Modal>
  );
}
