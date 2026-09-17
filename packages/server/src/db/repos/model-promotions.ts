/**
 * Per-Project model promotions: the fraction off a row's list price its seller is running.
 *
 * Not a cache. `.project_config.toml` keeps only the list price, so these rows are the one
 * record of each promotion: preset seeding, "sync presets" and Penguin Go authorization / sync
 * write them, cost reads them, and a row lost here prices that model at list until one of
 * those writers runs again. Both replace methods swap their whole set in one transaction, so
 * a reader never sees half of one.
 */
import { Component, Use } from "@prismshadow/penguin-core/kernel";
import type { Db } from "../../hmr/capabilities.js";
import type { ModelPromotion, ModelPromotions } from "../../mechanisms/projects.js";

@Component()
export class ModelPromotionsRepo implements ModelPromotions {
  @Use() private readonly db!: Db;

  get(projectId: string, provider: string, modelId: string): number | undefined {
    const r = this.db
      .prepare(
        "SELECT discount FROM model_promotions WHERE project_id = ? AND provider = ? AND model_id = ?",
      )
      .get(projectId, provider, modelId);
    return r ? (r.discount as number) : undefined;
  }

  list(projectId: string): ModelPromotion[] {
    return this.db
      .prepare("SELECT provider, model_id, discount FROM model_promotions WHERE project_id = ?")
      .all(projectId)
      .map((r) => ({
        provider: r.provider as string,
        modelId: r.model_id as string,
        discount: r.discount as number,
      }));
  }

  replaceAll(projectId: string, rows: readonly ModelPromotion[]): void {
    this.replace(projectId, undefined, rows);
  }

  replaceProvider(projectId: string, provider: string, rows: readonly ModelPromotion[]): void {
    this.replace(projectId, provider, rows);
  }

  /** Deletes the Project's rows (one group's, when `provider` is given) and inserts `rows`, atomically. */
  private replace(
    projectId: string,
    provider: string | undefined,
    rows: readonly ModelPromotion[],
  ): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (provider === undefined) {
        this.db.prepare("DELETE FROM model_promotions WHERE project_id = ?").run(projectId);
      } else {
        this.db
          .prepare("DELETE FROM model_promotions WHERE project_id = ? AND provider = ?")
          .run(projectId, provider);
      }
      const insert = this.db.prepare(
        `INSERT INTO model_promotions (project_id, provider, model_id, discount, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      );
      const updatedAt = new Date().toISOString();
      for (const row of rows) {
        // A group's replace must not reach into another group's rows it never deleted.
        if (provider !== undefined && row.provider !== provider) {
          throw new Error(
            `A ${provider} promotion replace was given a ${row.provider} row: ${row.modelId}.`,
          );
        }
        insert.run(projectId, row.provider, row.modelId, row.discount, updatedAt);
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}
