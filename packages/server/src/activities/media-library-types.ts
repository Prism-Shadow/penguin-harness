/**
 * The project's media library: every file uploaded to any live activity of one project,
 * each one tagged with the activity that owns it. Type-only, so the App can import it.
 */
import type { UploadedMedia } from "./upload.js";

/** One upload, and the activity whose workspace holds it. */
export interface LibraryFile extends UploadedMedia {
  activityId: string;
  activityTitle: string;
  productCode: string;
  refNum: number;
}

/** The listing: newest first, cut at a limit, and whether anything was left out. */
export interface ProjectMediaListing {
  files: LibraryFile[];
  truncated: boolean;
}

/** One file to put in a downloaded bundle. */
export interface BundleItem {
  activityId: string;
  path: string;
}
