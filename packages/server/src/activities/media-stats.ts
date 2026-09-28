/**
 * One bound or unbound asset of the media plan, with the size of the file it is bound to,
 * for Loom's Activity Stats. Its own module so the App can import the shape without
 * pulling the sandbox in.
 */
export interface MediaStat {
  language: string;
  key: string;
  type: "image" | "audio" | "video" | "animation";
  bound: boolean;
  /** The bound file's size, or null when it is unbound or no file was found for it. */
  bytes: number | null;
  /**
   * The bound file's content type, named from its extension (`audio/wav`, `video/mp4`, ...),
   * or null when it is unbound or the extension is not a media type this server names.
   */
  mimeType: string | null;
}
