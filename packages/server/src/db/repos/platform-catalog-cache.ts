/**
 * Rebuildable platform catalog promotion cache.
 *
 * Project TOML keeps the effective price used by cost accounting. These rows only explain a
 * platform-supplied promotion to interfaces; deleting the table contents can hide a badge but
 * cannot change a request or its calculated cost. The next authorization or sync rebuilds the
 * provider snapshot in one transaction.
 */
import { Component, Use } from "@prismshadow/penguin-core/kernel";
import type { Db } from "../../hmr/capabilities.js";
import type { PlatformCatalogCache } from "../../mechanisms/projects.js";
import type {
  PlatformCatalogPricing,
  PlatformCatalogPromotion,
  PlatformModelCatalog,
} from "../../services/platform-auth-types.js";

function pricing(
  row: Record<string, unknown>,
  prefix: "effective" | "list",
): PlatformCatalogPricing {
  return {
    unit: "usd_per_mtok",
    cacheRead: row[`${prefix}_cache_read`] as number,
    cacheWrite: row[`${prefix}_cache_write`] as number,
    output: row[`${prefix}_output`] as number,
  };
}

@Component()
export class PlatformCatalogCacheRepo implements PlatformCatalogCache {
  @Use() private readonly db!: Db;

  list(projectId: string, provider: string): PlatformCatalogPromotion[] {
    return this.db
      .prepare(
        `SELECT model_id,
                effective_cache_read, effective_cache_write, effective_output,
                list_cache_read, list_cache_write, list_output, discount
         FROM provider_catalog_cache
         WHERE project_id = ? AND provider = ?`,
      )
      .all(projectId, provider)
      .map((value) => {
        const row = value as Record<string, unknown>;
        return {
          modelId: row.model_id as string,
          pricing: pricing(row, "effective"),
          listPricing: pricing(row, "list"),
          discount: row.discount as number,
        };
      });
  }

  replace(projectId: string, provider: string, catalog: PlatformModelCatalog): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare("DELETE FROM provider_catalog_cache WHERE project_id = ? AND provider = ?")
        .run(projectId, provider);
      const insert = this.db.prepare(
        `INSERT INTO provider_catalog_cache (
           project_id, provider, model_id,
           effective_cache_read, effective_cache_write, effective_output,
           list_cache_read, list_cache_write, list_output,
           discount, synced_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const syncedAt = new Date().toISOString();
      for (const model of catalog.models) {
        if (model.listPricing === undefined || model.discount === undefined) continue;
        insert.run(
          projectId,
          provider,
          model.modelId,
          model.pricing.cacheRead,
          model.pricing.cacheWrite,
          model.pricing.output,
          model.listPricing.cacheRead,
          model.listPricing.cacheWrite,
          model.listPricing.output,
          model.discount,
          syncedAt,
        );
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}
