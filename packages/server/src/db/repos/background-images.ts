/**
 * user_background_images table repo: one custom background image per user, kept apart from
 * ui_prefs so the megabyte it may hold is read only when the image itself is asked for.
 */
import { Component, Use } from "@prismshadow/penguin-core/kernel";
import type { Db } from "../../hmr/capabilities.js";
import type { BackgroundImageStore, StoredBackgroundImage } from "../../mechanisms/account-data.js";

@Component()
export class BackgroundImagesRepo implements BackgroundImageStore {
  @Use() private readonly db!: Db;

  get(userId: string): StoredBackgroundImage | null {
    const row = this.db
      .prepare("SELECT image, image_id FROM user_background_images WHERE user_id = ?")
      .get(userId) as { image: string; image_id: string } | undefined;
    return row === undefined ? null : { image: row.image, imageId: row.image_id };
  }

  set(userId: string, image: StoredBackgroundImage): void {
    this.db
      .prepare(
        `INSERT INTO user_background_images (user_id, image, image_id, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           image = excluded.image, image_id = excluded.image_id, updated_at = excluded.updated_at`,
      )
      .run(userId, image.image, image.imageId, new Date().toISOString());
  }

  clear(userId: string): void {
    this.db.prepare("DELETE FROM user_background_images WHERE user_id = ?").run(userId);
  }
}
