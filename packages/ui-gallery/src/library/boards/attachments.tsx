/**
 * 附件: the images and files attached in a conversation, from the package — staged in the
 * composer (the remove buttons work, and a button puts everything back), the same tiles above a
 * sent message's text and inside a steer's chip, the whole range of image ratios and sizes, the
 * composer and a message at phone width with a file name longer than any tile, and an image that
 * fails to load.
 *
 * The pictures are SVGs drawn here at the sizes a real upload comes in, so each has its own
 * intrinsic ratio and the tiles lay out exactly as they do for a PNG.
 */
import { useState } from "react";
import {
  AttachmentFile,
  AttachmentImage,
  AttachmentList,
  Button,
  ComposerCard,
  MessageAttachments,
  MessageBubble,
  MessageMeta,
  MessageRow,
} from "@prismshadow/penguin-ui";
import { BoardGroup } from "../../foundations/shared";
import { useGallery } from "../../state";

/** A striped picture of the given size, labelled with it, as an SVG data URL. */
function picture(width: number, height: number, hue: number): string {
  const short = Math.min(width, height);
  const stripe = Math.max(2, Math.round(short / 8));
  const label =
    short >= 60
      ? `<text x="50%" y="50%" fill="white" font-family="sans-serif" font-weight="bold" font-size="${Math.round(short / 6)}" text-anchor="middle" dominant-baseline="middle">${width}×${height}</text>`
      : "";
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<defs><pattern id="s" width="${stripe * 2}" height="${height}" patternUnits="userSpaceOnUse">` +
    `<rect width="${stripe}" height="${height}" fill="hsl(${hue} 60% 40%)"/></pattern></defs>` +
    `<rect width="100%" height="100%" fill="hsl(${hue} 55% 62%)"/>` +
    `<rect width="100%" height="100%" fill="url(#s)"/>${label}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const IMAGES = {
  landscape: picture(1600, 900, 210),
  portrait: picture(900, 1600, 140),
  square: picture(800, 800, 30),
  tiny: picture(16, 16, 330),
  panorama: picture(3000, 300, 270),
  strip: picture(200, 2400, 180),
};

/** File names and sizes are data: the same in both languages. */
const FILES = [
  {
    name: "quarterly-infrastructure-review-final-version-with-appendix-and-all-the-raw-tables-2026.pdf",
    size: "2.4 MB",
  },
  { name: "results-2026-10-17.csv", size: "18 KB" },
  { name: "build.log", size: "6.1 KB" },
  { name: "deploy.py", size: "3.2 KB" },
  { name: "logs.zip", size: "11 MB" },
  { name: "Makefile", size: "1 KB" },
];

const STAGED_IMAGES = [IMAGES.landscape, IMAGES.portrait, IMAGES.square, IMAGES.tiny];
const STAGED_FILES = FILES.slice(0, 3);

/** Bytes that are not an image: the tile that stands in for an image that did not load. */
const MISSING = `data:image/png;base64,${btoa("not an image")}`;

export function AttachmentsBoard() {
  const { S } = useGallery();
  const t = S.library.attachments;
  const [images, setImages] = useState<readonly string[]>(STAGED_IMAGES);
  const [files, setFiles] = useState<readonly (typeof FILES)[number][]>(STAGED_FILES);
  const reset = () => {
    setImages(STAGED_IMAGES);
    setFiles(STAGED_FILES);
  };

  const staged = (
    <AttachmentList>
      {images.map((src, i) => (
        <AttachmentImage
          key={`image-${i}`}
          src={src}
          alt={t.imageAlt}
          removeLabel={t.removeImage}
          onRemove={() => setImages((was) => was.filter((_, j) => j !== i))}
        />
      ))}
      {files.map((file, i) => (
        <AttachmentFile
          key={`file-${i}`}
          name={file.name}
          size={file.size}
          removeLabel={`${t.removeFile} ${file.name}`}
          onRemove={() => setFiles((was) => was.filter((_, j) => j !== i))}
        />
      ))}
    </AttachmentList>
  );
  const composer = (
    <ComposerCard
      attachments={images.length > 0 || files.length > 0 ? staged : undefined}
      textarea={{ value: "", placeholder: t.placeholder, readOnly: true }}
    />
  );
  const sent = (sentImages: readonly string[], sentFiles: readonly (typeof FILES)[number][]) => (
    <MessageRow>
      <MessageAttachments>
        {sentImages.length > 0 && (
          <AttachmentList align="end">
            {sentImages.map((src, i) => (
              <AttachmentImage
                key={i}
                src={src}
                alt={t.imageAlt}
                size="md"
                unavailableLabel={t.unavailable}
              />
            ))}
          </AttachmentList>
        )}
        {sentFiles.length > 0 && (
          <AttachmentList align="end">
            {sentFiles.map((file, i) => (
              <AttachmentFile key={i} name={file.name} />
            ))}
          </AttachmentList>
        )}
      </MessageAttachments>
      <MessageBubble variant="user">{t.prompt}</MessageBubble>
      <MessageMeta time={t.time} copy={{ text: t.prompt, label: t.copy }} />
    </MessageRow>
  );

  return (
    <div className="gf-board">
      <BoardGroup
        title={t.composer}
        aside={t.composerHint}
        action={
          <Button size="sm" variant="secondary" onClick={reset}>
            {t.reset}
          </Button>
        }
      >
        <div
          className="lib-stack lib-stack-wide"
          style={{ maxWidth: "46rem" }}
          data-board="composer"
        >
          {composer}
        </div>
      </BoardGroup>
      <BoardGroup title={t.sent} aside={t.sentHint}>
        <div className="lib-stack lib-stack-wide" style={{ maxWidth: "46rem" }} data-board="sent">
          {sent([IMAGES.landscape, IMAGES.portrait, IMAGES.square], FILES.slice(0, 2))}
          {sent([IMAGES.portrait], [])}
        </div>
      </BoardGroup>
      <BoardGroup title={t.steer} aside={t.steerHint}>
        <div className="lib-stack lib-stack-wide" style={{ maxWidth: "46rem" }} data-board="steer">
          <MessageRow spacing="steer">
            <MessageBubble
              variant="steering"
              label={t.steerLabel}
              attachments={
                <AttachmentList>
                  <AttachmentImage src={IMAGES.square} alt={t.imageAlt} />
                  <AttachmentImage src={IMAGES.portrait} alt={t.imageAlt} />
                  <AttachmentFile name={FILES[0]!.name} />
                  <AttachmentFile name={FILES[1]!.name} />
                </AttachmentList>
              }
            >
              {t.steerText}
            </MessageBubble>
            <MessageMeta time={t.time} copy={{ text: t.steerText, label: t.copy }} />
          </MessageRow>
        </div>
      </BoardGroup>
      <BoardGroup title={t.shapes} aside={t.shapesHint}>
        <div className="lib-stack lib-stack-wide" data-board="shapes">
          <AttachmentList>
            {Object.values(IMAGES).map((src, i) => (
              <AttachmentImage key={i} src={src} alt={t.imageAlt} />
            ))}
          </AttachmentList>
          <AttachmentList>
            {Object.values(IMAGES).map((src, i) => (
              <AttachmentImage key={i} src={src} alt={t.imageAlt} size="md" />
            ))}
          </AttachmentList>
          <AttachmentList>
            {FILES.map((file) => (
              <AttachmentFile key={file.name} name={file.name} size={file.size} />
            ))}
          </AttachmentList>
        </div>
      </BoardGroup>
      <BoardGroup title={t.narrow} aside={t.narrowHint}>
        <div className="lib-stack" data-board="narrow" style={{ maxWidth: "22rem" }}>
          {composer}
          {sent([IMAGES.landscape, IMAGES.panorama], FILES.slice(0, 1))}
        </div>
      </BoardGroup>
      <BoardGroup title={t.failed} aside={t.failedHint}>
        <div className="lib-row" data-board="failed">
          <AttachmentImage src={MISSING} alt={t.imageAlt} unavailableLabel={t.unavailable} />
          <AttachmentImage
            src={MISSING}
            alt={t.imageAlt}
            size="md"
            unavailableLabel={t.unavailable}
          />
        </div>
      </BoardGroup>
    </div>
  );
}
