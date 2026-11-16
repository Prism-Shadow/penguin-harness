/**
 * What a theme pack may weigh (PRFC-0026 「文件格式与限制」). The archive caps are read from the
 * zip's central directory before anything is inflated (zip.ts); the per-kind caps are checked on
 * each entry's declared size there too, and again on the bytes that come back.
 */
const KiB = 1024;
const MiB = 1024 * KiB;

export const THEME_PACK_LIMITS = {
  /** Files in the zip; directory entries do not count. */
  entries: 200,
  /** The zip as uploaded. */
  archiveBytes: 16 * MiB,
  /** Every entry's declared size, added up. */
  unpackedBytes: 24 * MiB,
  manifestBytes: 16 * KiB,
  /** Every stylesheet, added up. */
  cssBytes: 512 * KiB,
  /** One `*.woff2`. */
  fontBytes: 4 * MiB,
  fontsBytes: 12 * MiB,
  svgBytes: 64 * KiB,
  /** One `*.png` or `*.webp`. */
  imageBytes: 256 * KiB,
  /** One `README.md`, `LICENSE*` or `LICENSES/*.txt`. */
  docBytes: 64 * KiB,
  /** One `data:` image in a stylesheet. */
  dataUriBytes: 32 * KiB,
  /** Every `data:` image, added up. */
  dataUrisBytes: 512 * KiB,
  /** Checking every stylesheet of one pack. */
  parseMs: 2000,
} as const;
